```javascript
/* =========================================================
   avatar.js
   Upload ảnh đại diện lên Supabase Storage
   Bucket: avatars
   Lưu URL vào: profiles.avatar_url
   ========================================================= */

/*
  QUAN TRỌNG:
  Thay 2 giá trị bên dưới bằng thông tin Supabase của bạn.

  Supabase Dashboard
  → Project Settings
  → API
*/

const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

/* =========================================================
   KHỞI TẠO SUPABASE
   ========================================================= */

if (!window.supabase) {
  console.error(
    "Chưa tải Supabase JS. Hãy thêm dòng CDN trước avatar.js:"
  );

  console.error(
    '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'
  );
}

const supabaseClient = window.supabase
  ? window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    )
  : null;


/* =========================================================
   HÀM LẤY USER HIỆN TẠI
   ========================================================= */

async function getCurrentUser() {
  if (!supabaseClient) {
    throw new Error("Supabase chưa được khởi tạo.");
  }

  const {
    data: { user },
    error
  } = await supabaseClient.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("Bạn chưa đăng nhập.");
  }

  return user;
}


/* =========================================================
   ĐỔI TÊN FILE
   Tránh lỗi tên file từ ảnh tải trên mạng
   ========================================================= */

function createSafeFileName(file) {
  const ext =
    file.name.split(".").pop()?.toLowerCase() || "jpg";

  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext)
    ? ext
    : "jpg";

  const random =
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()
          .toString(36)
          .substring(2)}`;

  return `${random}.${safeExt}`;
}


/* =========================================================
   UPLOAD AVATAR
   ========================================================= */

async function uploadAvatar(file) {
  try {
    if (!file) {
      throw new Error("Chưa chọn ảnh.");
    }

    // Chỉ cho phép ảnh
    if (!file.type.startsWith("image/")) {
      throw new Error("File được chọn không phải là ảnh.");
    }

    // Giới hạn 5MB
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Ảnh phải nhỏ hơn 5MB.");
    }

    const user = await getCurrentUser();

    const fileName = createSafeFileName(file);

    /*
      Mỗi tài khoản có một thư mục riêng:
      avatars/user-id/xxxx.jpg
    */

    const filePath = `${user.id}/${fileName}`;

    // Upload
    const {
      error: uploadError
    } = await supabaseClient.storage
      .from("avatars")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type
      });

    if (uploadError) {
      throw uploadError;
    }

    // Lấy URL public
    const {
      data: publicUrlData
    } = supabaseClient.storage
      .from("avatars")
      .getPublicUrl(filePath);

    const avatarUrl = publicUrlData.publicUrl;

    // Lưu URL vào profiles
  const {
  error: profileError
} = await supabaseClient
  .from("profiles")
  .upsert(
    {
      id: user.id,
      avatar_url: avatarUrl
    },
    {
      onConflict: "id"
    }
  );

    if (profileError) {
      throw profileError;
    }

    // Hiển thị avatar ngay lập tức
    updateAvatarImages(avatarUrl);

    console.log("Avatar uploaded:", avatarUrl);

    return {
      success: true,
      url: avatarUrl
    };

  } catch (error) {
    console.error("Upload avatar error:", error);

    alert(
      "Không thể tải ảnh đại diện:\n" +
      (error.message || "Lỗi không xác định")
    );

    return {
      success: false,
      error: error.message
    };
  }
}


/* =========================================================
   CẬP NHẬT ẢNH AVATAR TRÊN WEBSITE
   ========================================================= */

function updateAvatarImages(url) {

  // Các selector phổ biến
  const selectors = [
    "#avatar",
    "#avatarImage",
    "#profileAvatar",
    ".avatar",
    ".avatar-image",
    "[data-avatar]"
  ];

  selectors.forEach(selector => {

    document.querySelectorAll(selector).forEach(element => {

      if (element.tagName === "IMG") {
        element.src = url;
      } else {
        element.style.backgroundImage = `url("${url}")`;
      }

    });

  });
}


/* =========================================================
   LẤY AVATAR TỪ DATABASE
   ========================================================= */

async function loadAvatar() {
  try {

    const user = await getCurrentUser();

    const {
      data,
      error
    } = await supabaseClient
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data?.avatar_url) {
      updateAvatarImages(data.avatar_url);
    }

    return data?.avatar_url || null;

  } catch (error) {

    console.error(
      "Không thể tải avatar:",
      error
    );

    return null;
  }
}


/* =========================================================
   GẮN VÀO INPUT FILE
   ========================================================= */

function initAvatarUpload() {

  /*
    File input có thể đặt:
    <input type="file" id="avatarInput">
  */

  const input =
    document.querySelector("#avatarInput");

  if (!input) {
    console.warn(
      'Không tìm thấy input có id="avatarInput".'
    );
    return;
  }

  input.addEventListener("change", async event => {

    const file =
      event.target.files?.[0];

    if (!file) return;

    // Có thể hiển thị preview trước
    const localUrl =
      URL.createObjectURL(file);

    updateAvatarImages(localUrl);

    // Upload
    const result =
      await uploadAvatar(file);

    if (!result.success) {
      // Nếu upload lỗi thì tải lại avatar cũ
      await loadAvatar();
    }
  });
}


/* =========================================================
   KHỞI ĐỘNG
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

  // Gắn input upload
  initAvatarUpload();

  // Tải avatar hiện tại
  await loadAvatar();

});


/* =========================================================
   CHO PHÉP GỌI TỪ CODE KHÁC
   ========================================================= */

window.uploadAvatar = uploadAvatar;
window.loadAvatar = loadAvatar;
window.updateAvatarImages = updateAvatarImages;
```
