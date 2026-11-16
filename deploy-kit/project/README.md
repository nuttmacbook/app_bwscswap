# deploy-kit/project/ 🧪 เทสและเครื่องมือของเชนจำลอง

โปรแกรมจริงไม่ได้อยู่ที่นี่:
- `deploy-kit/bwsc/` ก้อปไป explorer
- `deploy-kit/bsc/` ก้อปไป Remix

| ไฟล์ | ทำอะไร |
| --- | --- |
| `test/<ชื่อ>.test.mjs` | เทสโปรแกรม แยกไฟล์ต่อเรื่อง (WBWSC, BwscDex, BwscStaking, BwscBridge, BwscBridgeEvm, Bridge end-to-end, Inputs) ทุกไฟล์เริ่มจากเชนใหม่ (`npm test`) · `Inputs.test.mjs` ดีพลอยตามคู่มือทีละขั้นด้วยไฟล์ใน `bwsc/inputs/` |
| `app-test/<ชื่อ>.app.mjs` | เทสหน้าเว็บทั้งแอปแบบคนใช้จริง: Swap (+Pool), Stake, Bridge (`npm run test:app`) |
| `test-setup.mjs` | สร้างคู่ swap และ pool stake ตาม `settings/test-setup.json` |
| `seed.mjs` | ข้อมูลตัวอย่างตอน `npm run dev` + ตัวช่วยที่เทสใช้ซ้ำ |
| `services.mjs` | เติมสภาพคล่อง bridge และเปิด bridge-signer บนเชนจำลอง |
| `app-config.mjs` | สร้างค่าตั้งของเชนจำลองแบบเดียวกับ `settings/config.js` แล้วส่งให้เว็บเป็น `VITE_CONFIG` (ไม่แตะไฟล์ของคุณ) |
| `devActions.js` | ปุ่มในแผงทดสอบที่ใช้เฉพาะโปรเจกต์นี้ |
