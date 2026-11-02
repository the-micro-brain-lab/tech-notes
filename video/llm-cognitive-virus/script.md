# Video 1 phút: LLM như một virus nhận thức

Video dọc 9:16 (1080×1920, 30 fps, ~62 giây) tóm tắt note
[LLM như một virus nhận thức](../../notes/llm-cognitive-virus/), dựa trên bài báo:

> Solé R., Ruffini G., Castaldo F., Tuccio M., Seoane L. F., De Domenico M., Elena S. F., Krakauer D. C., Levin M.
> “Large-Language Models as a Cognitive Virus”. arXiv:2609.03344 (2026).

Giọng đọc: `vi-VN-NamMinhNeural` (nam), chậm 2% và trầm hơn 6 Hz. Nhạc nền và hiệu ứng âm thanh được
tổng hợp trong `audio.py`, không dùng mẫu âm thanh có bản quyền.

## Phân cảnh

| # | Thời gian | Lời đọc | Hình |
|---|---|---|---|
| §1 Câu hỏi | 0–5 s | Nếu thói quen để AI nghĩ hộ lây lan như virus, xã hội sẽ ra sao? | 360 chấm (mỗi chấm một người) trôi trong đĩa. Một chấm chuyển màu C, sóng lây lan ra cả đĩa. Tiêu đề “LLM như một *virus* nhận thức?” |
| §2 Nguồn | 5–9 s | Một nhóm nhà khoa học đã mô hình hóa điều đó bằng toán học của dịch tễ. | Thẻ bài báo: arXiv:2609.03344, tên bài, 9 tác giả, sơ đồ U ⇄ C ⇄ D, “cùng họ với mô hình SIR” |
| §3 Mô hình | 10–15 s | Mỗi người ở một trong ba trạng thái: tự chủ, dùng có kiểm soát, hoặc lệ thuộc. | Các chấm bay vào ba ngăn U, C, D kèm ví dụ (tự đọc, tự viết, tự kiểm chứng · hỏi AI, rồi kiểm lại · dán vào, chép ra). Hình 1: không có đường tắt U → D |
| §4 Hai lực | 15–26 s | Hai lực giằng co: sức lây λ … sức kéo tập thể … mạnh theo bình phương … Họ thưa đi, nó yếu rất nhanh. | Phương trình (1) dU/dt = −λUC + ρC + κU²C, khung sáng lần lượt quanh hai số hạng; chấm chảy theo mũi tên. Hai thanh: U giảm 100 → 50 → 30%, sức kéo ∝ U² giảm 100 → 25 → 9% (hiệu ứng Allee) |
| §5 Thí nghiệm | 26–41 s | Tăng dần λ. Tới 0,45, chưa có gì. Vượt 0,5, cả quần thể lật. Hạ về 0,45, không quay lại. Phải dưới 0,4 mới hồi phục. | Đĩa quần thể + số đo U/C/D/⟨Γ⟩ + thanh trượt λ (0,30 → 0,45 → 0,60 → 0,45 → 0,30) + đồ thị U* theo λ với vệt quỹ đạo thật. Lời giải số RK4 của hệ phương trình với tham số của bài báo |
| §6 Vì sao | 41–49 s | Hai ngưỡng khác nhau, nên đường đi khác đường về: hiện tượng trễ. Năng lực tự làm khi bỏ công cụ rơi hơn một nửa. | Đồ thị trễ phóng to; λ_SN = 2√(κρ) = 0,40 và λ_TC = ρ + κ = 0,50; vòng trễ chạy sáng. Thanh ⟨Γ⟩: 1,00 → 0,43 (−57%), kẹt ở 0,62 trên đường về |
| §7 Bài học | 49–62 s | Bài học: thay đổi có thể đột ngột, khó đảo ngược, nên phòng dễ hơn chữa. Mô hình chỉ là lý thuyết, nhưng hãy tự hỏi: bỏ công cụ đi, mình còn lại gì? | Ba thẻ: Đột ngột · Khó đảo ngược · Phòng dễ hơn chữa. Ghi chú: mô hình lý thuyết, tham số minh họa, không phải dự báo. Câu hỏi cuối, đĩa xanh trở lại, link blog và trích dẫn đầy đủ |

## Hệ màu

Mỗi khái niệm một màu, dùng nhất quán trong phụ đề, nhãn, phương trình và đồ thị:

| Màu | Khái niệm |
|---|---|
| Chàm `#929AF2` | U, tự chủ; ρ và κ (kéo về tự chủ); sức kéo tập thể |
| Hổ phách `#E9AE4C` | C, dùng có kiểm soát; λ, sức lây |
| Hồng `#F27FA8` | D, lệ thuộc; cú lật; ngưỡng xâm nhập λ_TC = 0,50 |
| Xanh ngọc `#52C7AD` | hồi phục; ngưỡng hồi phục λ_SN = 0,40; năng lực ⟨Γ⟩ |
| Vàng nhạt `#E9C46A` | hiện tượng trễ, vùng hai trạng thái |

Font: Literata (tiêu đề, công thức), Be Vietnam Pro (chữ thường, phụ đề), JetBrains Mono (số đo).
`render.mjs` tự chuyển ký tự Hy Lạp, √, → sang Literata và ⟨⟩ sang JetBrains Mono vì Be Vietnam Pro không có các glyph này.

## Độ chính xác

- Tham số: ρ = 0,1; κ = 0,4; μ = 0,2; σ = 0,1 (minh họa, theo bài báo). Γ_U = 1, Γ_C = 0,5, Γ_D = 0,1 là giả định minh họa.
- λ_TC = ρ + κ = 0,50; λ_SN = 2√(κρ) = 0,40; ⟨Γ⟩* = 0,425 ngay sau khi lật, 0,617 tại λ_SN: khớp Hình 6 của note.
- Chấm trong §5 lấy trạng thái từ lời giải phương trình (thêm ε = 0,0004 tự tiếp xúc như mô phỏng trong note).
- Video nói rõ đây là mô hình lý thuyết, không phải dự báo.

## Dựng lại

```sh
./build.sh   # cần python có edge-tts, imageio-ffmpeg, numpy; node có @napi-rs/canvas (npm install)
```

`narration.py` → `build/narr_*.mp3` + `build/timeline.json` (mốc thời gian từng chữ) ·
`render.mjs` → `build/video.mp4` · `audio.py` → `build/mix.wav` · ghép và chuẩn hóa âm lượng −16 LUFS →
`llm-cognitive-virus.mp4`. `node render.mjs --still 12.5,34` xuất khung hình tĩnh để soát.
