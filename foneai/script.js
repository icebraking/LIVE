document.addEventListener('DOMContentLoaded', () => {
    const inputField = document.getElementById('question-input');
    const submitBtn = document.getElementById('submit-btn');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = loadingIndicator.querySelector('p');
    const chatHistory = document.getElementById('chat-history');

    const INITIAL_TEXT = "ASK ME ANYTHING F1 RELATED";
    let loadingTimeout1;
    let loadingTimeout2;

    // Live n8n Webhook Production URL
    const N8N_WEBHOOK_URL = 'https://anoop6611.app.n8n.cloud/webhook/f1-chatbot';

    // Generate a random Session ID for this chat session
    const sessionId = generateSessionId();

    let hasInteracted = false;

    // Auto-delete the placeholder text when clicked/focused
    inputField.addEventListener('focus', () => {
        if (!hasInteracted && inputField.value === INITIAL_TEXT) {
            inputField.value = '';
            hasInteracted = true;
        }
    });

    // Handle pressing 'Enter' key
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitQuestion();
        }
    });

    // Handle button click
    submitBtn.addEventListener('click', submitQuestion);

    async function submitQuestion() {
        const question = inputField.value.trim();

        // Don't submit if empty or if it's the initial placeholder text
        if (!question || question === INITIAL_TEXT) return;

        // Clear the input and show user's message
        inputField.value = '';
        appendMessage(question, 'user');

        // Initialize loading state text and timer
        loadingText.textContent = "ICE BRAKING";
        loadingIndicator.classList.remove('hidden');
        chatHistory.scrollTop = chatHistory.scrollHeight;

        loadingTimeout1 = setTimeout(() => {
            loadingText.textContent = "HARVESTING";
        }, 1000);

        loadingTimeout2 = setTimeout(() => {
            loadingText.textContent = "DEPLOYING";
        }, 2000);

        // Optional: disable input while processing
        inputField.disabled = true;
        submitBtn.disabled = true;

        try {
            await fetchFromn8n(question);
        } catch (error) {
            appendMessage("Communication failure. The team radio seems to be down. Please try again.", 'error');
            console.error("Webhook Error:", error);
        } finally {
            // Clear the timeouts if n8n replied faster
            clearTimeout(loadingTimeout1);
            clearTimeout(loadingTimeout2);

            // Re-enable input
            inputField.disabled = false;
            submitBtn.disabled = false;
            loadingIndicator.classList.add('hidden');
            inputField.focus();
        }
    }

    async function fetchFromn8n(question) {
        const payload = {
            question: question,
            sessionId: sessionId
        };

        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add any necessary authorization headers here if your webhook requires them
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const rawText = await response.text();
        let answerText = '';

        try {
            // Try parsing as JSON first
            const data = JSON.parse(rawText);

            // n8n returns a JSON object. We try to grab the AI's answer from common keys.
            answerText = data.text || data.response || data.answer || data.output || data.chatInput;

            // If the specific key wasn't found, display the whole JSON so we can read it
            if (!answerText) {
                // Strip out formatting if it's the exact 'myField' default snippet
                if (data.myField === "value") {
                    answerText = "Connection successful, but the n8n 'Respond to Webhook' node is currently set to return the default { myField: 'value' }. <br><br><b>Fix in n8n:</b> Open your 'Respond to Webhook' node and change the 'Respond With' parameter to output the AI Agent's text instead.";
                } else {
                    answerText = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
                }
            }
        } catch (e) {
            // If it's not JSON, it means n8n successfully returned exactly what you told it to: the raw text!
            // This happens when you set the Respond to Webhook node to return "Text" directly.
            answerText = rawText;
        }

        appendMessage(answerText, 'ai');
    }

    // A development helper to visualize how the UI works before the n8n webhook is ready
    function simulateResponse(question) {
        return new Promise(resolve => {
            setTimeout(() => {
                const dummyAnswer = `You asked: "${question}". <br><br><b>Notice:</b> This is a simulated response because the <code>N8N_WEBHOOK_URL</code> is still set to placeholder in <code>script.js</code>. Insert your live n8n webhook URL to start receiving real F1 data!`;
                appendMessage(dummyAnswer, 'ai');
                resolve();
            }, 2000); // 2 second delay to show off the loading animation
        });
    }

    function appendMessage(text, role) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');

        if (role === 'user') {
            msgDiv.classList.add('user-message');
        } else if (role === 'error') {
            msgDiv.classList.add('ai-message', 'error-message');
        } else {
            msgDiv.classList.add('ai-message');
        }

        // Simple HTML formatting for linebreaks from n8n
        const formattedText = text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
        msgDiv.innerHTML = `<p>${formattedText}</p>`;

        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    // Simple random ID generator for session management
    function generateSessionId() {
        return 'sess-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    }
});
