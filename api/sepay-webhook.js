export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    const auth = req.headers.authorization || "";
    const expected = `Apikey ${process.env.SEPAY_API_KEY}`;

    if (auth !== expected) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const transaction = req.body || {};

    const content = String(
      transaction.content ||
      transaction.description ||
      ""
    ).toUpperCase();

    const amount = Number(
      transaction.transferAmount ||
      transaction.amount ||
      0
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

    const oldPaid = Number(order.deposit_amount || 0);
    const total = Number(order.total_amount || 0);

    const newPaid = Math.min(oldPaid + amount, total);

    const status =
      newPaid >= total
        ? "Đã thanh toán"
        : "Đã cọc";

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
        body: JSON.stringify({
          deposit_amount: newPaid,
          status: status,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateResponse.ok) {
      throw new Error(
        await updateResponse.text()
      );
    }

    return res.status(200).json({
      success: true,
      order_code: orderCode,
      amount_received: amount,
      total_paid: newPaid,
      status
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}
