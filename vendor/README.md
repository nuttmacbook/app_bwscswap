# vendor/
- `bwscbox/` สำเนาไลบรารีกระเป๋า/เชน (ยังไม่ได้ขึ้น npm) — package.json อ้างด้วย `file:` จึง `npm install` ได้ทันที
- เมื่อ publish bwscbox ขึ้น npm แล้ว: เปลี่ยนเป็น `"bwscbox": "^0.1.0"` ทั้งใน `package.json` และ `deploy-kit/package.json` แล้วลบโฟลเดอร์นี้
- แก้ bwscbox ที่ repo ของมันเอง แล้วคัดลอก `src/` มาทับที่นี่ (อย่าแก้ที่นี่ตรง ๆ)
