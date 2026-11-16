# settings/ ⚙️ ไฟล์ตั้งค่าไฟล์เดียว

ทุกอย่างที่ปรับได้โดยไม่ต้องแก้โค้ดอยู่ใน **`config.js`** ไฟล์เดียว
- เว็บใช้ไฟล์นี้
- `bridge-signer/` ก็อ่านไฟล์นี้
- commit ได้ เพราะไม่มีความลับ **ห้ามใส่ private key**

| ส่วน | ตั้งอะไร |
| --- | --- |
| `app` | ชื่อเว็บ (ตอนนี้ "Bluewolfchain" เพราะเป็นเว็บหลักของเชน), tagline, คำอธิบายในหน้าแรก, โดเมนเว็บ (`siteUrl` ใช้ใน `<head>` และเป็น CORS ของ signer) |
| `hub` | เชน BWSC: chain id 41234, node / explorer `https://syncblock.network`, เหรียญ native |
| `programs` | **แอดเดรสหลังดีพลอย** `dex`, `staking`, `limit`, `bridge` |
| `chains` | เชนอื่นที่ bridge ไป (ตอนนี้ BSC): chain id, RPC, explorer, เหรียญหลัก, `bridge` = **แอดเดรส proxy**, `confirmations` |
| `wallet` | `reownProjectId`: Project ID ของ Reown (ฟรีที่ https://dashboard.reown.com) ใช้เชื่อมกระเป๋า **ต้องใส่ก่อน build** และต้องเพิ่มโดเมนเว็บใน dashboard ของ Reown ด้วย |
| `directory` | แอพในหน้า Apps / หน้าแอพ / หน้าแรก / ช่องค้นหา: `categories` (หมวด + สี `tone`) และ `apps` · การ์ด: `name`, `category`, `description`, `logo` · หน้าแอพ: `cover`, `about`, `screenshots`, `developer`, `links`, `programs` · badge: `core`, `audit: { by, url, date }`, `risk: "low" \| "medium" \| "high"`, `status: "beta"`, `addedAt` (New 30 วัน), ไม่มี `url` = Coming soon · ตัวอย่างเกม 4 เกม (รูปใน `public/apps/`) อยู่ในไฟล์แล้ว แก้เป็นของจริงได้เลย |
| `bridgeSigner` | `url` ของ bridge-signer · `autoDeliver` (true = เหรียญเข้าเองไม่ต้องกดเคลม) · `gasDrop` เหรียญหลักที่แจกกระเป๋าใหม่ครั้งเดียวต่อเชน (`"0"` = ปิด) |
| `tokens` | เหรียญที่รู้จัก: `chain`, `address`, `symbol`, ชื่อเต็ม · `wraps: "native"` = wBWSC (ไม่มีราคาในนี้) |
| `prices` | `unit`: เหรียญที่ใช้นับราคา (USDT) · ทุกราคาอ่านจาก pool บนเชน ไม่มีการพิมพ์ราคาเอง |
| `swap` | slippage ตั้งต้น + ปุ่มตัวเลือก, `deadlineMinutes` ตั้งต้น (คนใช้เปลี่ยนเองได้ในปุ่มเฟือง จำไว้ในเบราว์เซอร์), จำนวนทอดสูงสุดของเส้นทาง |

**เพิ่มของใหม่**
- **คู่ swap / pool stake:** ไม่ต้องแก้ไฟล์นี้ สร้างจากหน้าเว็บแล้วเว็บอ่านจากเชนเอง ใส่เหรียญใน `tokens` เฉพาะเมื่ออยากได้ชื่อเต็ม ราคา หรือลำดับ
- **เส้นทาง bridge ใหม่:** `setRoute` ทั้งสองฝั่ง (ดู `deploy-kit/README.md`) แล้วเพิ่มเหรียญใน `tokens`
- **เชนใหม่:** เพิ่ม `{ key, short, name, chainId, rpcUrl, explorerUrl, native, bridge, confirmations }` ใน `chains` (ตัวอย่างอยู่ในคอมเมนต์ของไฟล์) แล้วเพิ่มเหรียญของเชนนั้นใน `tokens` · ขั้นตอนดีพลอยฝั่งเชนอยู่ใน `deploy-kit/README.md`

**ค่าที่ไม่ครบหรือผิด**
- ค่าผิดหรือขาดค่าที่จำเป็น: เว็บขึ้น "Setup is not finished" พร้อมรายการที่ต้องแก้
- แอดเดรสที่ยังว่าง: เว็บไม่หยุด หน้าที่ใช้แอดเดรสนั้นจะบอกว่ายังไม่ได้ตั้งค่า

สีของเว็บอยู่ที่ `src/project/ui/theme.css` เพราะเป็นงานออกแบบ ไม่ใช่ค่าตั้ง

**เว็บเป็นภาษาอังกฤษทั้งหมด:** ถ้าใส่ข้อความภาษาไทยในช่องไหนของ `settings/config.js` (ชื่อแอพ คำอธิบาย ชื่อเชน ฯลฯ) หน้าเว็บจะไม่เปิด และบอกว่าช่องไหนมีภาษาไทย ให้แก้เป็นภาษาอังกฤษ (คอมเมนต์ `//` ในไฟล์ไม่นับ)
