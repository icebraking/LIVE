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

            // Handle potential array response from n8n
            const obj = Array.isArray(data) && data.length > 0 ? data[0] : data;

            // n8n returns a JSON object. We try to grab the AI's answer from common keys.
            answerText = obj.text || obj.response || obj.answer || obj.output || obj.chatInput || obj.message;

            // If the specific key wasn't found, try to extract any valid string value
            if (!answerText) {
                // Strip out formatting if it's the exact 'myField' default snippet
                if (obj.myField === "value") {
                    answerText = "Connection successful, but the n8n 'Respond to Webhook' node is currently set to return the default { myField: 'value' }. <br><br><b>Fix in n8n:</b> Open your 'Respond to Webhook' node and change the 'Respond With' parameter to output the AI Agent's text instead.";
                } else if (typeof obj === 'string') {
                    answerText = obj;
                } else if (typeof obj === 'object' && obj !== null) {
                    for (const key of Object.keys(obj)) {
                        if (typeof obj[key] === 'string' && obj[key].trim().length > 0) {
                            answerText = obj[key];
                            break;
                        }
                    }
                    if (!answerText) {
                        answerText = JSON.stringify(obj, null, 2);
                    }
                } else {
                    answerText = String(obj);
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
        let finalHtml = '';

        if (role === 'ai') {
            let cleanText = typeof text === 'string' ? text : String(text);

            // Basic Markdown Parsing for display
            // 1. Headers (### Title -> <h3>Title</h3>)
            cleanText = cleanText.replace(/^(#{1,6})\s+(.*)$/gm, (match, hashes, content) => {
                const level = hashes.length;
                return `<h${level}>${content}</h${level}>`;
            });

            // 2. Bold (**text** -> <strong>text</strong>)
            cleanText = cleanText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            // 3. Italic (*text* -> <em>text</em>)
            cleanText = cleanText.replace(/\*(.*?)\*/g, '<em>$1</em>');

            // 4. Tables
            // Simple approach: look for lines with | and construct HTML tables
            if (cleanText.includes('|')) {
                const lines = cleanText.split('\n');
                let inTable = false;
                let tableHtml = [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('|') && line.endsWith('|')) {
                        if (!inTable) {
                            inTable = true;
                            tableHtml.push('<table style="width:100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; border: 1px solid var(--accent-cyan);">');
                        }

                        // Check if it's a separator line like |---|---|
                        if (line.match(/^\|[-:\| ]+\|$/)) {
                            continue;
                        }

                        const cells = line.split('|').slice(1, -1).map(c => c.trim());
                        let rowHtml = '<tr>';
                        cells.forEach(cell => {
                            // If first row in table, make it a th
                            const tag = tableHtml.length === 1 ? 'th' : 'td';
                            rowHtml += `<${tag} style="padding: 8px; border: 1px solid var(--accent-cyan); text-align: left;">${cell}</${tag}>`;
                        });
                        rowHtml += '</tr>';
                        tableHtml.push(rowHtml);
                    } else {
                        if (inTable) {
                            inTable = false;
                            tableHtml.push('</table>');
                        }
                        tableHtml.push(line);
                    }
                }
                if (inTable) {
                    tableHtml.push('</table>');
                }
                cleanText = tableHtml.join('\n');
            }

            // 5. Lists (- Item -> <ul><li>Item</li></ul>)
            cleanText = cleanText.replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>');
            // Wrap loose li elements in uls
            cleanText = cleanText.replace(/(<li>.*<\/li>(\n<li>.*<\/li>)*)/g, '<ul style="padding-left: 20px;">$1</ul>');

            // 6. Line breaks
            // Fix newlines that aren't inside HTML tags
            const blocks = cleanText.split('\n\n');
            finalHtml = blocks.map(block => {
                if (block.startsWith('<h') || block.startsWith('<table') || block.startsWith('<ul')) {
                    return block; // Don't wrap structural blocks in p tags
                } else {
                    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
                }
            }).join('');

        } else {
            // For user messages, just do basic HTML escaping and line breaks
            let cleanText = typeof text === 'string' ? text : String(text);
            finalHtml = `<p>${cleanText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
        }

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');

        if (role === 'user') {
            msgDiv.classList.add('user-message');
        } else if (role === 'error') {
            msgDiv.classList.add('ai-message', 'error-message');
        } else {
            msgDiv.classList.add('ai-message');
        }

        msgDiv.innerHTML = finalHtml;

        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    // Simple random ID generator for session management
    function generateSessionId() {
        return 'sess-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    }
});
