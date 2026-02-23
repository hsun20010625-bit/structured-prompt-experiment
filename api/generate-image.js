import { google } from "googleapis";
async function appendToSheetSafe({ mode, prompt, imageUrl }) {
    try {
        const auth = new google.auth.JWT(
            process.env.GOOGLE_CLIENT_EMAIL,
            null,
            process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            ["https://www.googleapis.com/auth/spreadsheets"]
        );

        const sheets = google.sheets({ version: "v4", auth });

        const now = new Date();
        const date = now.toISOString().split("T")[0];
        const time = now.toTimeString().split(" ")[0];

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: "工作表1!A:E",
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[date, time, mode, prompt, imageUrl]],
            },
        });
    } catch (err) {
        console.error("Sheets backup failed:", err);
    }
}
export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method === "GET") {
        return res.status(200).json({
            ok: true,
            message: "Use POST with JSON: { prompt: string, mode: 'structured'|'natural' }",
        });
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { prompt, mode } = req.body || {};

        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ error: "Prompt is required" });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                error: "Server configuration error (GEMINI_API_KEY missing)",
            });
        }

        const API_URL =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

        const styledPrompt = `
A professional studio product photo.

Object: ${prompt}

Background:
pure solid white background (#FFFFFF), seamless, no texture, no gradient

Lighting:
flat even lighting, no shadows

Color:
grayscale only, black and white, fully desaturated, no color

Composition:
single object, centered, isolated, product catalog style
`;

        const upstream = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: styledPrompt }],
                    },
                ],
                generationConfig: {
                    responseModalities: ["IMAGE"],
                },
            }),
        }).finally(() => clearTimeout(timeout));

        const rawText = await upstream.text();

        if (!upstream.ok) {
            return res.status(upstream.status).json({
                error: "Upstream Gemini error",
                status: upstream.status,
                details: rawText.slice(0, 1000),
            });
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            return res.status(500).json({
                error: "Gemini returned non-JSON response",
                details: rawText.slice(0, 1000),
            });
        }

        const part =
            data?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData);

        const inlineData = part?.inlineData;

        if (inlineData?.data && inlineData?.mimeType) {

            const imageUrl = `data:${inlineData.mimeType};base64,${inlineData.data}`;

            // 背景寫入（不 await，不影響生圖）
            appendToSheetSafe({
                mode: mode || "unknown",
                prompt,
                imageUrl,
            });

            return res.status(200).json({
                image: imageUrl,
                mode: mode || "unknown",
            });
        }

        return res.status(500).json({
            error: "Model did not return image",
            raw: data,
        });
    } catch (err) {
        return res.status(500).json({
            error:
                err?.name === "AbortError"
                    ? "Upstream request timed out"
                    : err?.message || String(err),
        });
    }
}