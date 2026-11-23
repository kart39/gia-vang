# Theo dõi giá vàng theo giờ: thiết kế

Ngày: 2026-11-23

## Mục đích

Người dùng muốn theo dõi giá vàng liên tục theo từng giờ để **canh thời điểm mua**. App cần đơn giản, ít tính năng.

## Mục tiêu

- Ghi giá vàng **mỗi giờ, 24/7**, kể cả khi máy tính của người dùng tắt.
- Có một trang web xem được trên cả điện thoại lẫn máy tính, gồm:
  1. Giá mua và giá bán hiện tại của **vàng miếng SJC**, **nhẫn trơn 999.9** và **vàng thế giới (XAU/USD)**, kèm thời điểm cập nhật.
  2. **Biểu đồ giá theo giờ**, chọn được 1 ngày, 7 ngày hoặc 30 ngày. Biểu đồ là đường tô màu: **đoạn giá tăng màu xanh, đoạn giá giảm màu đỏ**, đoạn đi ngang màu xám. Người dùng chọn kiểu này thay vì biểu đồ nến hay biểu đồ cột.
  3. **Giá muốn mua**: người dùng nhập mức giá cho SJC và cho nhẫn trơn. Khi giá bán mới nhất ≤ mức đó, trang hiện một thông báo nổi bật.
  4. **Tăng/giảm so với 24 giờ trước**, hiện bằng số tiền chênh lệch và mũi tên màu.

## Không làm

- Thông báo đẩy về điện thoại qua ntfy, Telegram hay email. Người dùng đã chọn chỉ hiện cảnh báo trên trang.
- Đăng nhập, nhiều người dùng.
- Dự đoán giá, lời khuyên mua bán. App chỉ hiển thị số liệu.
- Giá của các thương hiệu khác (DOJI, Bảo Tín Minh Châu…) và vàng nữ trang. Có thể thêm sau.
- Quy đổi giá thế giới sang VND.

## Những lỗi phải tránh

Các lỗi sau làm app hỏng về mặt mục đích dù code vẫn chạy:

- Hiển thị giá cũ như thể là giá mới. Trang luôn ghi "cập nhật lúc …". Nếu dữ liệu đã cũ hơn 3 giờ, trang hiện cảnh báo.
- Nối liền các giờ bị thiếu dữ liệu trên biểu đồ, khiến người dùng tưởng giá đi ngang. Giờ nào thiếu thì biểu đồ để trống chỗ đó.
- Sai đơn vị: nhầm giữa nghìn/triệu, chỉ/lượng.

## Ràng buộc và dữ liệu

| Nguồn | Địa chỉ | Ghi chú |
|---|---|---|
| PNJ | `https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00` | Đã thử ngày 2026-11-23: chạy được, không cần key. Lấy `masp: "SJC"` (vàng miếng SJC 999.9) và `masp: "N24K"` (nhẫn trơn PNJ 999.9). Trường `giamua` và `giaban` tính theo **nghìn đồng/chỉ**, ví dụ 13500 = 13,5 triệu/chỉ = 135 triệu/lượng. |
| gold-api.com | `https://api.gold-api.com/price/XAU` | Đã thử ngày 2026-11-23: chạy được, không cần key. Trả về `price`, đơn vị USD/ounce. |
| SJC | sjc.com.vn | **Không dùng** vì bị Cloudflare chặn truy cập tự động. Giá SJC lấy qua PNJ. |

- Lịch chạy của GitHub Actions có thể trễ vài phút, đôi khi bỏ qua một lần chạy. Việc này chấp nhận được, và giờ bị thiếu sẽ hiện thành khoảng trống trên biểu đồ.
- Repo phải để **public** thì GitHub Pages mới miễn phí. Dữ liệu chỉ là giá vàng nên không có gì riêng tư.
- GitHub tự tắt lịch chạy của repo không có hoạt động trong 60 ngày. Mỗi giờ đều có commit dữ liệu mới nên repo luôn được tính là đang hoạt động.

## Các cách đã cân nhắc

| Cách | Đánh đổi |
|---|---|
| A. Trang web tự lấy giá khi đang mở | Đơn giản nhất, nhưng lịch sử bị hổng mỗi khi tắt trang |
| B. Script Python chạy ngầm trên máy | Ghi liên tục nhưng máy phải luôn bật, và chỉ xem được trên máy đó |
| **C. GitHub Actions + GitHub Pages** ✅ | Ghi giá 24/7, xem được trên điện thoại. Cần tài khoản GitHub và khoảng 10 phút cài đặt lúc đầu |

**Người dùng đã chọn C** vì cần ghi giá liên tục theo giờ và xem được ở mọi nơi.

## Cách làm (đã thống nhất)

- **Thu thập:** một workflow GitHub Actions chạy mỗi giờ, gọi script lấy giá từ PNJ và gold-api, ghi thêm một dòng vào file lịch sử trong repo rồi commit.
- **Hiển thị:** một trang tĩnh trên GitHub Pages, đọc file lịch sử đó.
- **Cảnh báo giá:** chỉ hiện trên trang.

## Phần người làm tự quyết (quyết định của Claude, người dùng có thể sửa)

- **Ngôn ngữ của script:** Python, chỉ dùng thư viện chuẩn để không phải cài thêm gì. Có test cho phần đọc và chuyển đổi dữ liệu.
- **Lịch chạy:** phút thứ 5 mỗi giờ (`5 * * * *`). Tránh đúng đầu giờ vì lúc đó GitHub đông tác vụ.
- **Lưu trữ:** file `data/history.json`, mỗi lần chạy thêm một bản ghi `{t, sjc_buy, sjc_sell, ring_buy, ring_sell, xau_usd}`. Giá trong nước lưu đúng đơn vị gốc của PNJ (nghìn đồng/chỉ). Nguồn nào lỗi thì ghi `null` cho phần đó, vẫn lưu phần còn lại. Nếu cả hai nguồn đều lỗi thì bỏ qua lần chạy đó, không commit. Lưu toàn bộ lịch sử: mỗi năm khoảng 1 MB, không đáng kể.
- **Đơn vị hiển thị:** giá trong nước hiện theo **triệu đồng/lượng** (cách báo chí hay dùng), kèm giá mỗi chỉ ở dòng nhỏ bên dưới. Giá thế giới hiện theo USD/ounce.
- **Giá muốn mua:** nhập ngay trên trang và lưu trong trình duyệt. Mỗi thiết bị nhớ mức giá riêng. So sánh với **giá bán** vì đó là giá người dùng phải trả khi mua.
- **Trang web:** một file HTML, biểu đồ vẽ bằng Chart.js tải từ CDN, giao diện ưu tiên điện thoại. Khi đang mở, trang tự tải lại dữ liệu mỗi 10 phút.
- **Tên repo:** `gia-vang`.
- **Cài đặt GitHub:** nếu máy đã có `gh` CLI và đã đăng nhập, Claude tạo repo và bật Pages giúp, sau khi người dùng đồng ý. Nếu chưa, Claude viết hướng dẫn từng bước.

## Thay đổi 2026-11-23 (theo yêu cầu người dùng)

Người dùng yêu cầu: lấy giá **Hà Nội**, **bỏ giá vàng thế giới**, và muốn dùng giá từ trang SJC và Bảo Tín Mạnh Hải.

- **Trang SJC:** không dùng được. Trang có lớp chặn máy tự động của Cloudflare, và chúng ta không vượt lớp chặn. Giá vàng miếng SJC lấy qua các tiệm niêm yết nó.
- **Bảo Tín Mạnh Hải:** chưa xác minh được nguồn dữ liệu dùng được. Người dùng chấp nhận dùng nguồn khác, "miễn là nó uy tín".
- **Nguồn mới (thay toàn bộ nguồn cũ):**

| Nguồn | Địa chỉ | Sản phẩm | Đơn vị gốc |
|---|---|---|---|
| PNJ, chi nhánh Hà Nội | `https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=11` (`chinhanh: "hanoi"`) | `masp` `SJC`, `N24K` | nghìn đồng/chỉ |
| Bảo Tín Minh Châu (BTMC) | `https://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v` | tên `VÀNG MIẾNG SJC (Vàng SJC)`, `NHẪN TRÒN TRƠN (Vàng Rồng Thăng Long)`. Danh sách có nhiều mốc giờ cho cùng một sản phẩm, lấy mốc `@d_N` (`dd/MM/yyyy HH:mm`) mới nhất | đồng/chỉ, ÷1000 khi lưu |

- **Bản ghi mới:** `{t, pnj_sjc_buy, pnj_sjc_sell, pnj_ring_buy, pnj_ring_sell, btmc_sjc_buy, btmc_sjc_sell, btmc_ring_buy, btmc_ring_sell}`, tất cả tính theo nghìn đồng/chỉ. Không còn `xau_usd`.
  - Ba bản ghi cũ (PNJ TP.HCM, cùng giá với Hà Nội trong ngày 23/11) được đổi tên trường sang `pnj_*`, giá thế giới bị bỏ. *(quyết định của Claude)*
- **Bảng giá:** hai nhóm (Nhẫn trơn 999.9, Vàng miếng SJC), mỗi nhóm một dòng PNJ và một dòng Bảo Tín Minh Châu.
- **Biểu đồ:** chọn Nhẫn trơn hoặc SJC. Hai đường: PNJ nét liền, Bảo Tín Minh Châu nét đứt. Cả hai vẫn tô xanh/đỏ theo tăng/giảm. *(quyết định của Claude)*
- **Giá muốn mua:** vẫn một mức cho mỗi loại vàng. Báo khi **tiệm rẻ nhất** có giá bán ≤ mức đó, và ghi rõ tên tiệm.
- **Cảnh báo dữ liệu cũ:** tính riêng cho từng nguồn.
