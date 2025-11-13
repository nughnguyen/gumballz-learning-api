// api/data-viewer.js
const fetch = require('node-fetch');

// Lấy BASE_API_URL từ host của chính request
function getBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    return `${protocol}://${host}`;
}

module.exports = async (req, res) => {
    const BASE_URL = getBaseUrl(req);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    let levelsData = { success: false, message: "Lỗi tải Levels" };
    let topicsData = { success: false, message: "Lỗi tải Topics" };

    try {
        // 1. Lấy danh sách Levels
        const levelsRes = await fetch(`${BASE_URL}/api/vocabulary/list-levels`);
        levelsData = await levelsRes.json();
        
        // 2. Lấy danh sách Topics (Ví dụ Level A1)
        if (levelsData.success && levelsData.data.length > 0) {
             const testLevel = levelsData.data[0].level;
             const topicsRes = await fetch(`${BASE_URL}/api/vocabulary/list-topics?level=${testLevel}`);
             topicsData = await topicsRes.json();
             
             // 3. Lấy nội dung bài học chi tiết (Ví dụ Topic đầu tiên)
             if (topicsData.success && topicsData.data.length > 0) {
                const testTopic = topicsData.data[0].topic;
                const encodedTopic = encodeURIComponent(testTopic);
                
                const lessonUrl = `${BASE_URL}/api/lesson/${testLevel}/${encodedTopic}`;
                const lessonRes = await fetch(lessonUrl);
                const lessonData = await lessonRes.json();
                
                // Thêm dữ liệu bài học vào topicsData để hiển thị
                topicsData.lesson_details = { 
                    endpoint: lessonUrl,
                    data: lessonData 
                };
             }
        }

    } catch (error) {
        console.error("Lỗi khi fetch API nội bộ:", error);
    }
    
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gumballz API Viewer</title>
            <style>
                body { font-family: sans-serif; margin: 20px; background-color: #f4f4f9; }
                h1 { color: #9333ea; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
                h2 { color: #3b82f6; margin-top: 30px; }
                pre { background-color: #fff; border: 1px solid #ccc; padding: 15px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
                .success { border-left: 5px solid #10b981; }
                .error { border-left: 5px solid #ef4444; }
                p { font-weight: bold; }
                code { background-color: #eee; padding: 2px 4px; border-radius: 4px; }
                a { color: #9333ea; }
            </style>
        </head>
        <body>
            <h1>Gumballz CSV Data Viewer (Vercel API)</h1>
            <p>Đây là giao diện kiểm tra dữ liệu được đồng bộ từ Google Sheet CSV của bạn. Dữ liệu được cache 1 giờ.</p>

            <h2>1. Danh sách Levels (/api/vocabulary/list-levels)</h2>
            <p>Trạng thái: <span style="color:${levelsData.success ? '#10B981' : '#EF4444'}">${levelsData.success ? 'THÀNH CÔNG' : 'LỖI'}</span></p>
            <pre class="${levelsData.success ? 'success' : 'error'}">${JSON.stringify(levelsData.data, null, 2)}</pre>
            
            <h2>2. Danh sách Topics (Ví dụ Level ${levelsData.success && levelsData.data.length > 0 ? levelsData.data[0].level : 'N/A'})</h2>
            <p>Endpoint: <code>/api/vocabulary/list-topics?level=${levelsData.success && levelsData.data.length > 0 ? levelsData.data[0].level : 'N/A'}</code></p>
            <p>Trạng thái: <span style="color:${topicsData.success ? '#10B981' : '#EF4444'}">${topicsData.success ? 'THÀNH CÔNG' : 'LỖI'}</span></p>
            <pre class="${topicsData.success ? 'success' : 'error'}">${JSON.stringify(topicsData.data, null, 2)}</pre>

            <h2>3. Nội dung bài học (Chi tiết Topic đầu tiên)</h2>
            <p>Endpoint: <a href="${topicsData.lesson_details ? topicsData.lesson_details.endpoint : '#'}" target="_blank">${topicsData.lesson_details ? topicsData.lesson_details.endpoint : 'N/A'}</a></p>
            <p>Trạng thái: <span style="color:${topicsData.lesson_details && topicsData.lesson_details.data.success ? '#10B981' : '#EF4444'}">${topicsData.lesson_details && topicsData.lesson_details.data.success ? 'THÀNH CÔNG' : 'LỖI'}</span></p>
            <pre class="${topicsData.lesson_details && topicsData.lesson_details.data.success ? 'success' : 'error'}">${JSON.stringify(topicsData.lesson_details ? topicsData.lesson_details.data.data : topicsData.lesson_details?.data || { message: "Không thể load chi tiết bài học" }, null, 2)}</pre>
            
        </body>
        </html>
    `;

    res.status(200).send(htmlContent);
};