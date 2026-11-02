# Tech Notes

Blog tĩnh lưu các tech notes, deploy bằng GitHub Pages:
https://the-micro-brain-lab.github.io/tech-notes/

## Cấu trúc

```
index.html                # trang danh sách notes (mới nhất ở trên)
assets/site.css           # font, màu nền/chữ dùng chung, thanh menu, mục lục bên trái
assets/toc.js             # tô sáng mục đang đọc trong mục lục
notes/<slug>/index.html   # mỗi note là một trang HTML độc lập
.nojekyll                 # tắt Jekyll, serve file nguyên trạng
```

## Style dùng chung

`assets/site.css` định nghĩa các token `--note-*`. Mỗi note giữ CSS riêng và màu nhấn riêng
(cho hình minh hoạ, mô phỏng), nhưng trỏ các biến trung tính và font của nó vào token chung:

| Token | Dùng cho |
|---|---|
| `--note-bg`, `--note-surface`, `--note-sunken` | nền trang, nền khối, nền chìm |
| `--note-ink`, `--note-muted`, `--note-line` | chữ, chữ phụ, đường kẻ |
| `--note-font-body` | chữ thường (Be Vietnam Pro) |
| `--note-font-heading` | tiêu đề (Literata) |
| `--note-font-mono` | code (JetBrains Mono) |

Ví dụ: `:root { --paper: var(--note-bg); --ink: var(--note-ink); --sans: var(--note-font-body); }`.
Font được tải trong `site.css`, note không cần link Google Fonts riêng.

## Thêm note mới

1. Tạo `notes/<slug>/index.html` (ví dụ export từ một Claude artifact). Kiểm tra không còn
   tham chiếu tới runtime của claude.ai (`/_runtime/…`, `window.claude`).
2. Trong `<head>`:
   ```html
   <link rel="stylesheet" href="../../assets/site.css?v=N">
   <script src="../../assets/toc.js?v=N" defer></script>
   ```
3. Ngay sau `<body>`, khối `<nav class="site-nav">` (copy từ note có sẵn).
4. Trỏ màu trung tính và font của note vào token `--note-*` (bảng trên), bỏ link Google Fonts riêng.
5. Mục lục: cột đầu tiên của grid layout, các mục trỏ tới id của `section` hoặc `h2`:
   ```html
   <nav class="note-toc" aria-label="Mục lục">
     <p>Mục lục</p>
     <ol><li><a href="#phan-1">Phần 1</a></li></ol>
   </nav>
   ```
   Grid gợi ý: `@media (min-width: 1100px) { .shell { display: grid; grid-template-columns: 13rem minmax(0, 1fr); gap: 3rem; } }`.
6. Thêm một `<li>` vào danh sách trong `index.html` (mới nhất ở trên).
7. Commit và push lên `main`.

Khi sửa `site.css` hoặc `toc.js`, tăng số `?v=N` trong link ở mọi trang để trình duyệt không dùng bản cũ trong cache.
