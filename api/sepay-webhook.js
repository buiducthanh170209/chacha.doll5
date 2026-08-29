export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const auth = req.headers.authorization || "";
    const expected = `Apikey ${process.env.SEPAY_API_KEY}`;

    if (!process.env.SEPAY_API_KEY || auth !== expected) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const transaction = req.body || {};
    const content = String(
      transaction.content ||
      transaction.description ||
      transaction.transferContent ||
      ""
    ).toUpperCase();

    const amount = Number(
      transaction.transferAmount ||
      transaction.amount ||
      0
    );

    const txId = String(
      transaction.id ||
      transaction.transaction_id ||
      transaction.referenceCode ||
      transaction.reference ||
      ""
    );

    if (!amount || !content) {
      return res.status(400).json({
        success: false,
        message: "Thiếu nội dung hoặc số tiền giao dịch"
      });
    }

    const match = content.match(/DH-\d+/);
    if (!match) {
      return res.status(200).json({
        success: true,
        message: "Không tìm thấy mã đơn"
      });
    }

    const orderCode = match[0];
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, message: "Server misconfigured" });
    }

    // Chống xử lý trùng giao dịch
    if (txId) {
      const dupRes = await fetch(
        `${supabaseUrl}/rest/v1/orders?payment_transaction_id=eq.${encodeURIComponent(txId)}&select=id`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
          }
        }
      );
      const dups = await dupRes.json();
      if (Array.isArray(dups) && dups.length > 0) {
        return res.status(200).json({
          success: true,
          message: "Giao dịch đã được xử lý trước đó",
          order_code: orderCode
        });
      }
    }

    const findResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?order_code=eq.${encodeURIComponent(orderCode)}&select=*`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const orders = await findResponse.json();
    if (!orders.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn " + orderCode
      });
    }

    const order = orders[0];
    const oldPaid = Number(order.deposit_amount || order.paid_amount || 0);
    const total = Number(order.total_amount || 0);
    const newPaid = Math.min(oldPaid + amount, total);

    let payment_status = "pending";
    let status = order.status;

    if (newPaid >= total && total > 0) {
      payment_status = "paid";
      status = "Đã thanh toán";
    } else if (newPaid > 0) {
      payment_status = "partial";
      if (status === "Chờ xác nhận") status = "Đã cọc";
    }

    const updateBody = {
      deposit_amount: newPaid,
      paid_amount: newPaid,
      payment_status,
      status,
      payment_content: content,
      payment_time: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (txId) updateBody.payment_transaction_id = txId;

    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify(updateBody)
      }
    );

    if (!updateResponse.ok) {
      throw new Error(await updateResponse.text());
    }

    return res.status(200).json({
      success: true,
      order_code: orderCode,
      amount_received: amount,
      total_paid: newPaid,
      payment_status,
      status
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal error"
    });
  }
}
