# src/project/ ✏️ โค้ดของคุณ (เว็บ)

แยกเป็น 2 ฝั่ง ห้ามปนกัน:

| โฟลเดอร์ | คืออะไร | import อะไรได้ |
| --- | --- | --- |
| `chain/` **on-chain** | คุยกับโปรแกรมบนเชน (รายละเอียดด้านล่าง) | `engine/chain`, `engine/settings` |
| `ui/` **off-chain** | หน้าตา: `main.js` (หน้า + ปุ่ม), `pages/` (home, swap, pool, stake, bridge), `componants/` (picker ที่ค้นหาและวางแอดเดรสได้), `toast.js`, `theme.css` | `../chain` (`index.js` เท่านั้น), `engine/ui`, `engine/settings` |

ไฟล์ใน `chain/`:
- `programs.js`: แอดเดรสจาก `settings/config.js` + ฟังก์ชันที่เรียกได้
- `coins.js`: เชน, เหรียญ, ราคา
- `dex.js`: คู่, หาเส้นทาง, swap, LP, สร้างคู่
- `staking.js`
- `bridge.js`: หลายเชน, หลายเส้นทาง
- `abi/`: ABI ฝั่ง EVM
- `index.js`: ประตูเดียวที่ UI ใช้

UI ไม่ import bwscbox หรือ `engine/chain` ตรง ๆ จึงเปลี่ยนโปรแกรมได้โดยไม่แตะหน้าเว็บ และแก้หน้าเว็บได้โดยไม่แตะโปรแกรม
