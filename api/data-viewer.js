const fetch = require('node-fetch');
const csv = require('csvtojson');

// URL Google Sheet CSV của bạn
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTy8CweGTUMVlovuY8BwSwcjKKCHxKC7VGIGNnQ_Yuj6kxSg3R5h4kIifd_ZFRzdlK5aVzS3q4608v5/pub?gid=0&single=true&output=csv";

// === THỐNG KÊ TOÀN CỤC (SỐNG TRONG THỜI GIAN INSTANCE WARM) ===
let cachedData = null;
let updateCount = 0;
let lastUpdateTime = 'Chưa cập nhật';

// ✅ ĐÃ THAY ĐỔI: Đặt thời gian khởi động cố định (12:00 trưa 13/11/2025 GMT+7)
// Tương đương với 2025-11-13T05:00:00.000Z
const serverStartTime = new Date('2025-11-13T05:00:00.000Z');

const CACHE_DURATION = 3600 * 1000; // 1 giờ

// Hàm format thời gian
const formatTime = (date) => {
    if (date === 'Chưa cập nhật') return date;
    // Sử dụng 'Asia/Ho_Chi_Minh' để hiển thị thời gian chính xác theo giờ Việt Nam
    return new Date(date).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
};

// Hàm tính Uptime
const formatUptime = (start) => {
    const diff = new Date().getTime() - start.getTime();
    if (diff < 0) return "Đã đặt giờ trong tương lai"; 
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    let parts = [];
    if (days > 0) parts.push(`${days} ngày`);
    if (hours > 0) parts.push(`${hours} giờ`);
    if (minutes > 0) parts.push(`${minutes} phút`);
    if (parts.length === 0) parts.push(`${seconds} giây`);
    
    return parts.join(' ');
};

// Hàm lấy và phân tích dữ liệu CSV (Đã tích hợp thống kê)
async function getAndParseData() {
    if (cachedData && new Date().getTime() - cachedData.cacheTime < CACHE_DURATION) {
        return cachedData.data;
    }

    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        const csvText = await response.text();
        
        const data = await csv({
            noheader: false,
            headers: ['level', 'topic', 'word', 'wordType', 'phonetic', 'mean', 'definition_vi', 'definition_us', 'example', 'synonym', 'antonym'],
            skipLines: 0 
        }).fromString(csvText);

        const filteredData = data.filter(row => row.word && row.level);
        
        // Cập nhật thống kê
        updateCount++;
        lastUpdateTime = new Date();
        cachedData = { data: filteredData, cacheTime: new Date().getTime() };
        
        return filteredData;

    } catch (error) {
        console.error("Lỗi khi tải hoặc phân tích CSV:", error);
        // Nếu lỗi nhưng có cache cũ, sử dụng cache cũ
        if (cachedData) return cachedData.data;
        throw new Error("Không thể tải hoặc xử lý dữ liệu nguồn.");
    }
}

// Hàm chính của Serverless Function
module.exports = async (req, res) => {
    // 1. Tải và Cập nhật Thống kê
    let rawData = [];
    let loadError = null;
    try {
        rawData = await getAndParseData();
    } catch (e) {
        loadError = e.message;
    }
    
    const BASE_URL = `https://${req.headers.host}`;
    
    // 2. Xử lý logic hiển thị
    
    const levelMap = rawData.reduce((acc, row) => {
        const level = row.level.toUpperCase().trim();
        if (!acc[level]) {
            acc[level] = { level: level, word_count: 0, topicSet: new Set() };
        }
        acc[level].word_count += 1;
        acc[level].topicSet.add(row.topic);
        return acc;
    }, {});
    
    const levelsArray = Object.values(levelMap)
        .map(item => ({
            level: item.level,
            word_count: item.word_count,
            topic_count: item.topicSet.size
        }))
        .sort((a, b) => a.level.localeCompare(b.level));
        
    const levelsStatus = { success: !loadError, message: loadError || "Thành công", data: levelsArray };
    
    let topicsStatus = { success: false, message: "Level test không khả dụng", data: [] };
    let lessonStatus = { success: false, message: "Lesson test không khả dụng", data: [] };
    let globalStats = { totalLevels: 0, totalTopics: 0, totalWords: 0, levelStats: [] };

    let testLevel = null;
    let testTopic = null;

    if (levelsArray.length > 0) {
        testLevel = levelsArray[0].level;
        
        // Giả lập logic Topics (Sử dụng dữ liệu cached thay vì gọi API)
        const filteredData = rawData.filter(row => row.level && row.level.toUpperCase().trim() === testLevel);
        const topicMap = filteredData.reduce((acc, row) => {
            if (!row.topic) return acc;
            const topicName = row.topic.trim();
            if (!acc[topicName]) {
                acc[topicName] = { topic: topicName, word_count: 0 };
            }
            acc[topicName].word_count += 1;
            return acc;
        }, {});
        topicsStatus = { success: true, message: "Thành công", data: Object.values(topicMap) };

        if (topicsStatus.data.length > 0) {
             testTopic = topicsStatus.data[0].topic;
             
             // Giả lập logic Lesson
             const lessonData = filteredData.filter(row => row.topic && row.topic.trim() === testTopic);
             lessonStatus = { success: true, message: "Thành công", data: lessonData.slice(0, 3) }; // Lấy 3 từ đầu
        }
        
        // Tính Global Stats
        const allTopics = new Set(rawData.map(r => `${r.level}|${r.topic}`));
        globalStats = {
            totalLevels: levelsArray.length,
            totalTopics: allTopics.size,
            totalWords: rawData.length,
            levelStats: levelsArray
        };
    }

    // 3. Render HTML
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    const renderDataBox = (title, status, data, endpointPath) => {
        const isSuccess = status.success;
        const stateClass = isSuccess ? 'bg-green-100 border-green-500' : 'bg-red-100 border-red-500';
        const stateColor = isSuccess ? 'text-green-700' : 'text-red-700';

        const displayData = data ? data.slice(0, 3) : []; // Giới hạn hiển thị 3 item đầu tiên

        return `
            <div class="bg-white p-6 rounded-xl shadow-lg mb-6 transition duration-300 hover:shadow-xl">
                <h3 class="text-xl font-bold mb-3 text-gray-800">${title}</h3>
                <p class="text-sm text-gray-500 mb-2">Endpoint: <code class="text-xs bg-gray-100 px-1 py-0.5 rounded">${endpointPath}</code></p>
                <div class="p-3 rounded-lg ${stateClass} border-l-4">
                    <p class="font-semibold text-sm ${stateColor}">Trạng thái: ${status.message}</p>
                    <p class="text-xs ${stateColor}/80 mt-1">Kết quả: ${isSuccess ? data.length + ' mục đã tìm thấy' : 'Không có dữ liệu.'}</p>
                </div>
                ${isSuccess && displayData.length > 0 ? `
                    <div class="mt-4 space-y-2 text-sm text-gray-700">
                        <p class="font-semibold text-gray-600">Dữ liệu mẫu (${displayData.length} mục đầu tiên):</p>
                        ${displayData.map(item => `
                            <div class="bg-gray-50 p-2 rounded-lg text-xs">
                                <strong>Level:</strong> ${item.level || item.word || item.topic}, 
                                <strong>Word/Topic:</strong> ${item.word || item.topic || 'N/A'},
                                <strong>Count:</strong> ${item.word_count || item.topic_count || 'N/A'}
                            </div>
                        `).join('')}
                        <p class="text-xs text-gray-500 mt-2">Tổng số mục: ${data.length}</p>
                    </div>
                ` : ''}
            </div>
        `;
    };

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gumballz API Dashboard</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body { font-family: 'Inter', sans-serif; background-color: #f4f7f9; }
                .text-purple-600 { color: #9333EA; }
                .bg-purple-100 { background-color: #F3E8FF; }
            </style>
        </head>
        <body>
            <div class="container mx-auto p-4 sm:p-8">
                <header class="mb-8">
                    <h1 class="text-4xl font-extrabold text-purple-600 border-b-4 border-purple-200 pb-2">
                        Gumballz API Dashboard
                    </h1>
                    <p class="text-gray-600 mt-2">Trạng thái đồng bộ dữ liệu từ Google Sheet CSV.</p>
                </header>

                <!-- Thống kê Server -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-blue-500">
                        <p class="text-sm font-medium text-gray-500">Thời gian bắt đầu dự án</p>
                        <p class="text-2xl font-bold text-gray-800 mt-1">${formatTime(serverStartTime)}</p>
                        <p class="text-sm text-gray-500 mt-1">Giờ Việt Nam (GMT+7).</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-yellow-500">
                        <p class="text-sm font-medium text-gray-500">Thời gian hoạt động (Uptime)</p>
                        <p class="text-2xl font-bold text-gray-800 mt-1">${formatUptime(serverStartTime)}</p>
                        <p class="text-sm text-gray-500 mt-1">Tính từ mốc 12h ngày 13/11/2025.</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-purple-500">
                        <p class="text-sm font-medium text-gray-500">Cập nhật gần nhất</p>
                        <p class="text-2xl font-bold text-gray-800 mt-1">${formatTime(lastUpdateTime)}</p>
                        <p class="text-sm text-gray-500 mt-1">Số lần đồng bộ: ${updateCount}</p>
                    </div>
                </div>
                
                <!-- Thống kê dữ liệu CSV tổng quát -->
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Thống kê Dữ liệu Tổng quát (CSV)</h2>
                 <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-green-500">
                        <p class="text-sm font-medium text-gray-500">Tổng Level</p>
                        <p class="text-3xl font-bold text-gray-800 mt-1">${globalStats.totalLevels}</p>
                        <p class="text-sm text-gray-500 mt-1">Hiện có: ${globalStats.levelStats.map(s => s.level).join(', ')}</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-indigo-500">
                        <p class="text-sm font-medium text-gray-500">Tổng Chủ đề</p>
                        <p class="text-3xl font-bold text-gray-800 mt-1">${globalStats.totalTopics}</p>
                        <p class="text-sm text-gray-500 mt-1">Qua tất cả các Level.</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-pink-500">
                        <p class="text-sm font-medium text-gray-500">Tổng Từ vựng</p>
                        <p class="text-3xl font-bold text-gray-800 mt-1">${globalStats.totalWords}</p>
                        <p class="text-sm text-gray-500 mt-1">Tất cả các Level và Chủ đề.</p>
                    </div>
                </div>


                <!-- Bảng kiểm tra API -->
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Kiểm tra Endpoints</h2>
                
                ${renderDataBox(
                    '1. Danh sách Levels (Level Array)', 
                    levelsStatus, 
                    levelsStatus.data,
                    '/api/vocabulary/list-levels'
                )}

                ${renderDataBox(
                    `2. Danh sách Topics (Test Level: ${testLevel || 'N/A'})`,
                    topicsStatus, 
                    topicsStatus.data,
                    `/api/vocabulary/list-topics?level=${testLevel || 'N/A'}`
                )}
                
                 ${renderDataBox(
                    `3. Nội dung Bài học (Test Topic: ${testTopic || 'N/A'})`,
                    lessonStatus, 
                    lessonStatus.data,
                    `/api/lesson/${testLevel || 'N/A'}/${encodeURIComponent(testTopic || 'N/A')}`
                )}

                <footer class="text-center mt-10 text-sm text-gray-500">
                    Sử dụng Serverless Function trên Vercel để đồng bộ dữ liệu từ Google Sheet CSV.
                </footer>
            </div>
        </body>
        </html>
    `;

    res.status(200).send(htmlContent);
};