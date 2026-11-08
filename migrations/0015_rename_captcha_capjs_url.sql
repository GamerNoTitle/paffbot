-- 人机验证现在有两种提供方，CAPTCHA_URL 这个名字有歧义，改成明确的 CAPTCHA_CAPJS_URL
UPDATE settings SET key = 'CAPTCHA_CAPJS_URL' WHERE key = 'CAPTCHA_URL';
