# Tech Notes

Blog tĩnh lưu các tech notes, deploy bằng GitHub Pages:
https://the-micro-brain-lab.github.io/tech-notes/

## Cấu trúc

```
index.html                # trang danh sách notes (mới nhất ở trên)
assets/site.css           # thanh menu dùng chung (link về Home)
notes/<slug>/index.html   # mỗi note là một trang HTML độc lập
.nojekyll                 # tắt Jekyll, serve file nguyên trạng
```

## Thêm note mới

1. Tạo `notes/<slug>/index.html` (ví dụ export từ một Claude artifact).
2. Thêm `<link rel="stylesheet" href="../../assets/site.css">` vào `<head>` và khối
   `<nav class="site-nav">` ngay sau `<body>` (copy từ note có sẵn).
3. Thêm một `<li>` lên đầu danh sách trong `index.html`.
4. Commit và push lên `main`.
