const express = require("express");
const bodyParser = require("body-parser");
const { chromium } = require("playwright");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

app.post("/check-fine", async (req, res) => {
  const { type, idValue, nationality, visaNumber } = req.body;

  if (!type || !idValue || !nationality) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("https://gdrfad.gov.ae/en/fines-inquiry-service", { waitUntil: "networkidle" });

    // Select Inquiry Type (UID or Passport)
    if (type === "uid") {
      await page.click('label[for="fine-inquiry-radio-option-uid"]');
      await page.fill('input[name="uid"]', idValue);
    } else {
      await page.click('label[for="fine-inquiry-radio-option-passport"]');
      await page.fill('input[name="passport"]', idValue);
    }

    // Select nationality
    await page.selectOption('select[name="nationality"]', nationality);

    // Optional visa number
    if (visaNumber) {
      await page.fill('input[name="visaNumber"]', visaNumber);
    }

    // Handle CAPTCHA
    const captchaImage = await page.$('img[alt="captcha"]');
    const captchaSrc = await captchaImage.getAttribute('src');
    const captchaBuffer = await captchaImage.screenshot();

    // Send to 2Captcha
    const base64Captcha = captchaBuffer.toString("base64");

    const captchaRes = await axios.post("http://2captcha.com/in.php", null, {
      params: {
        method: "base64",
        key: process.env.CAPTCHA_API_KEY,
        body: base64Captcha,
        json: 1
      }
    });

    const captchaId = captchaRes.data.request;
    let captchaText = null;

    // Wait for solution
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const result = await axios.get("http://2captcha.com/res.php", {
        params: {
          key: process.env.CAPTCHA_API_KEY,
          action: "get",
          id: captchaId,
          json: 1
        }
      });

      if (result.data.status === 1) {
        captchaText = result.data.request;
        break;
      }
    }

    if (!captchaText) {
      throw new Error("Captcha solving failed.");
    }

    // Enter captcha and submit
    await page.fill('input[name="captcha"]', captchaText);
    await page.click('button[type="submit"]');

    // Wait and get result
    await page.waitForTimeout(5000); // Adjust this depending on real delay
    const fineInfo = await page.textContent(".fine-result"); // Adjust selector

    res.json({ success: true, result: fineInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to check fine." });
  } finally {
    await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
