# نشر خادم تخزين مدارك (بديل Firebase)

نظام التخزين: خادم Node.js صغير يحفظ البيانات في SQLite على نفس السيرفر،
ويزامنها لحظياً بين الأجهزة عبر SSE. التطبيق يتصل بالخادم تلقائياً، وعند أول
تشغيل ينقل بياناتك من Firebase دفعة واحدة (دون حذف أي شيء من Firebase).

## الخطوات (على السيرفر، كـ root)

### 1) اسحب آخر تحديث
```
cd /var/www/madarek && git pull
```

### 2) شغّل سكربت الإعداد (مرة واحدة)
```
bash /var/www/madarek/deploy/setup.sh
```
يثبّت Node، اعتماديات الخادم، يولّد توكناً سرياً، يشغّل الخدمة، ويجدول نسخة
احتياطية يومية. سيطبع `API_TOKEN=...` ويعرض فحص الصحة `{"ok":true,...}`.

### 3) أضف مسار /api إلى nginx
عدّل `/etc/nginx/sites-available/madarek` وأضف داخل **كل** كتلة `server`
(منفذ 80 ومنفذ 443 الذي أضافه certbot) الكتلتين التاليتين قبل `location / {`:
```
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_read_timeout 1h;
}
location = /api/stream {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 24h;
}
```
ثم:
```
nginx -t && systemctl reload nginx
```

### 4) افتح الموقع
افتح `https://kidsenses.today` وسجّل دخول كمدير عام. عند أول تحميل ستظهر رسالة
**«تم نقل بياناتك إلى السيرفر»** — البيانات الآن تُحفظ على سيرفرك.

## التحقق
- `curl -s http://127.0.0.1:3001/api/health` → عدد المفاتيح > 0 بعد النقل.
- `systemctl status madarek-api` → active (running).
- النسخ الاحتياطي: `/var/backups/madarek/`.

## أوامر مفيدة
```
systemctl restart madarek-api     # إعادة تشغيل الخدمة
journalctl -u madarek-api -n 50   # سجل الخدمة
/usr/local/bin/madarek-backup.sh  # نسخة احتياطية فورية
```
