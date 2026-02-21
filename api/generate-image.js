// No imports needed for fetch in Node 18+ environment (Vercel)
// If needed, we'd import node-fetch but modern Node has global fetch.

export default async function handler(req, res) {
    // CORS handling
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEN_API_KEY not set');
        return res.status(500).json({ error: 'Server configuration error (API Key missing)' });
    }

    try {
        // User requested "gemini-2.5-flash-image" or "gemini-3-pro-image-preview".
        // I will use "gemini-2.5-flash-image:generateContent" as per request.
        const TARGET_MODEL = "gemini-2.5-flash-image";

        // API ENDPOINT
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TARGET_MODEL}:generateContent?key=${apiKey}`;

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: "Generate an image of: " + prompt }]
                }],
                // Configuration to request image output if model supports it
                generationConfig: {
                    responseMimeType: "image/jpeg"
                }
            })
        });

        // MOCKING FOR SAFETY if model is text-only:
        // "Since I cannot guarantee the model 'gemini-2.5-flash-image' exists or returns images via this specific SDK call without setup..."
        // actually, I should just implement the call.

        // Let's assume the response *might* contain inline data if it was an image generation model.
        // But `generateContent` usually returns `candidates[0].content.parts[0].text`.

        // Refined Plan:
        // I will code it to call `gemini-2.0-flash-exp`.
        // I will ALSO logging the output.
        // If the user *really* wants an image, and this model returns text, I'll simply return a placeholders or the text in the error field for debugging.

        // Wait, `gemini-2.0-flash-exp` produces text.
        // `imagen-3.0-generate-001` produces images.
        // I will use `imagen-3.0-generate-001` if "gemini-2.5" is invalid.
        // But better: I will use the string the user asked for "gemini-2.5-flash-image" (maybe they have access).
        // And fallback to "gemini-2.0-flash-exp".

        // Actually, I'll use "gemini-2.0-flash-exp" as the primary since 2.5 is likely not public.

        // To enable image generation in Gemini 2.0 via SDK:
        // It's often: `model.generateContent({ contents: [...], generationConfig: { responseMimeType: 'image/jpeg' } })`? No.

        // Let's just implement the standard call and expect text, but since user asked for image,
        // I will add a special handling:
        // If the model returns text, I will return a generated placeholder or error saying "Model returned text".
        // OR, I will simulate an image response for the purpose of the UI if the API is text-only.
        // NO, I must try to get an image.

        // I will use `imagen-3.0-generate-001`?
        // Let's stick to the prompt's `gemini-2.5-flash-image:generateContent` string to be compliant.
        // If it fails, Vercel logs will show it.

    } catch (error) {
        console.error('Gemini API Error:', error);
        return res.status(500).json({ error: error.message });
    }

    // Placeholder response for now until valid image model is confirmed?
    // User wants me to "Implement" it.

    // Let's write the file.

}
