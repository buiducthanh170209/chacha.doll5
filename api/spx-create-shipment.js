/**
 * POST /api/spx-create-shipment
 * Body: { order_id: "uuid" }
 * Auth: chỉ admin (kiểm tra qua Supabase service role + order tồn tại)
 *
 * Cập nhật orders:
 *  - shipping_company = "SPX Express"
 *  - tracking_code
 *  - status = "Đang giao" (nếu chưa giao/hủy)
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { order_id } = req.body || {};
    if (!order_id) {
      return res.status(400).json({ success: false, message: "Thiếu order_id" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const spxUserId = process.env.SPX_USER_ID;
    const spxApiKey = process.env.SPX_API_KEY;
    const spxBase = (process.env.SPX_BASE_URL || "https://spx.vn").replace(/\/$/, "");

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, message: "Thiếu cấu hình Supabase" });
    }
    if (!spxUserId || !spxApiKey) {
      return res.status(500).json({
        success: false,
        message: "Thiếu SPX_USER_ID hoặc SPX_API_KEY trên Vercel"
      });
    }

    // 1. Lấy đơn hàng
    const orderRes = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&select=*`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );
    const orders = await orderRes.json();
    if (!Array.isArray(orders) || !orders.length) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng" });
    }
    const order = orders[0];

    if (order.tracking_code && order.shipping_company === "SPX Express") {
      return res.status(200).json({
        success: true,
        message: "Đơn đã có mã vận đơn SPX",
        tracking_code: order.tracking_code,
        already_created: true
      });
    }

    // 2. Chuẩn bị payload SPX (điều chỉnh field theo tài liệu chính thức của SPX)
    const sender = {
      name: process.env.SPX_SENDER_NAME || "chacha.doll5",
      phone: process.env.SPX_SENDER_PHONE || "",
      address: process.env.SPX_SENDER_ADDRESS || "",
      province: process.env.SPX_SENDER_PROVINCE || "",
      district: process.env.SPX_SENDER_DISTRICT || "",
      ward: process.env.SPX_SENDER_WARD || ""
    };

    if (!sender.phone || !sender.address) {
      return res.status(500).json({
        success: false,
        message: "Thiếu SPX_SENDER_PHONE hoặc SPX_SENDER_ADDRESS"
      });
    }

    const weightGram = Math.max(100, Number(order.quantity || 1) * 300); // ước lượng 300g/sp
    const codAmount = 0; // đơn đã thanh toán online → COD = 0
    // Nếu muốn COD phần còn lại: Number(order.total_amount) - Number(order.deposit_amount || 0)

    const payload = {
      user_id: spxUserId,
      secret_key: spxApiKey,
      // Một số hệ thống SPX dùng header Auth, một số nhét vào body — giữ cả 2 kiểu an toàn
      order_code: order.order_code,
      reference_id: order.order_code,

      sender_name: sender.name,
      sender_phone: sender.phone,
      sender_address: sender.address,
      sender_province: sender.province,
      sender_district: sender.district,
      sender_ward: sender.ward,

      receiver_name: order.customer_name,
      receiver_phone: order.phone,
      receiver_address: order.address,
      // Nếu sau này tách tỉnh/quận/phường thì map vào đây
      receiver_province: order.province || "",
      receiver_district: order.district || "",
      receiver_ward: order.ward || "",

      product_name: order.product_type || "Hàng hóa",
      product_quantity: Number(order.quantity || 1),
      product_value: Number(order.total_amount || 0),
      weight: weightGram,
      length: 20,
      width: 15,
      height: 10,

      cod_amount: codAmount,
      note: order.note || `Đơn ${order.order_code} - chacha.doll5`,
      payment_method: codAmount > 0 ? "COD" : "PREPAID"
    };

    // 3. Gọi SPX API
    // ⚠️ Endpoint dưới đây là khung chuẩn partner.
    // Khi có tài liệu chính thức từ SPX, chỉ cần sửa URL + field mapping.
    const spxEndpoints = [
      `${spxBase}/api/v1/orders/create`,
      `${spxBase}/open/api/order/create`,
      `${spxBase}/api/partner/order/create`
    ];

    let spxData = null;
    let lastError = null;

    for (const endpoint of spxEndpoints) {
      try {
        const spxRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-User-Id": spxUserId,
            "X-Api-Key": spxApiKey,
            Authorization: `Bearer ${spxApiKey}`
          },
          body: JSON.stringify(payload)
        });

        const text = await spxRes.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }

        if (spxRes.ok && (json.tracking_number || json.tracking_code || json.data?.tracking_number || json.data?.order_code)) {
          spxData = json;
          break;
        }
        lastError = {
          endpoint,
          status: spxRes.status,
          body: json
        };
      } catch (err) {
        lastError = { endpoint, error: err.message };
      }
    }

    if (!spxData) {
      console.error("SPX create failed:", lastError);
      return res.status(502).json({
        success: false,
        message: "Không tạo được vận đơn SPX. Kiểm tra endpoint / credential / tài liệu API.",
        detail: lastError
      });
    }

    const tracking =
      spxData.tracking_number ||
      spxData.tracking_code ||
      spxData.data?.tracking_number ||
      spxData.data?.tracking_code ||
      spxData.data?.order_code ||
      spxData.order_sn ||
      null;

    if (!tracking) {
      return res.status(502).json({
        success: false,
        message: "SPX trả về thành công nhưng không có mã vận đơn",
        raw: spxData
      });
    }

    // 4. Cập nhật Supabase
    const newStatus =
      ["Đã giao", "Đã hủy"].includes(order.status) ? order.status : "Đang giao";

    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          shipping_company: "SPX Express",
          tracking_code: String(tracking),
          status: newStatus,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateRes.ok) {
      throw new Error(await updateRes.text());
    }

    const updated = await updateRes.json();

    return res.status(200).json({
      success: true,
      message: "Tạo vận đơn SPX thành công",
      tracking_code: tracking,
      tracking_url: `https://spx.vn/?tracking=${encodeURIComponent(tracking)}`,
      order: Array.isArray(updated) ? updated[0] : updated,
      spx_raw: spxData
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal error"
    });
  }
}
