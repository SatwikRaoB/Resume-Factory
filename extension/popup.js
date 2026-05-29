const SERVER_URL = "http://127.0.0.1:5000";
const statusBadge = document.getElementById('connectionStatus');
const sendBtn = document.getElementById('sendBtn');
const messageDiv = document.getElementById('message');

// Check Server Status
fetch(`${SERVER_URL}/ping`)
    .then(() => {
        statusBadge.innerText = "Online";
        statusBadge.className = "status-badge status-online";
        sendBtn.disabled = false;
    })
    .catch(() => {
        statusBadge.innerText = "Offline";
        statusBadge.className = "status-badge status-offline";
        sendBtn.disabled = true;
        messageDiv.innerText = "Error: Is app.py running?";
        messageDiv.className = "text-error";
    });

sendBtn.onclick = async () => {
    const text = document.getElementById('jdInput').value;
    const title = document.getElementById('filenameInput').value;

    if (!text) {
        messageDiv.innerText = "Please paste a Job Description.";
        messageDiv.className = "text-error";
        return;
    }

    sendBtn.innerHTML = "Sending...";
    sendBtn.disabled = true;

    try {
        const response = await fetch(`${SERVER_URL}/api/queue/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                title: title
            })
        });

        if (response.ok) {
            messageDiv.innerText = "Success! Added to queue.";
            messageDiv.className = "text-success";
            document.getElementById('jdInput').value = "";
            document.getElementById('filenameInput').value = "";
            setTimeout(() => window.close(), 1500);
        } else {
            throw new Error("Server Error");
        }
    } catch (error) {
        messageDiv.innerText = "Failed to send. Check server.";
        messageDiv.className = "text-error";
        sendBtn.innerHTML = "Try Again";
        sendBtn.disabled = false;
    }
};