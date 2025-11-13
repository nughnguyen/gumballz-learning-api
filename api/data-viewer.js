const fetch = require('node-fetch');
const csv = require('csvtojson');

// URL Google Sheet CSV của bạn
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTy8CweGTUMVlovuY8BwSwcjKKCHxKC7VGIGNnQ_Yuj6kxSg3R5h4kIifd_ZFRzdlK5aVzS3q4608v5/pub?gid=0&single=true&output=csv";

// === THỐNG KÊ TOÀN CỤC (SỐNG TRONG THỜI GIAN INSTANCE WARM) ===
let cachedData = null;
let updateCount = 0;
let lastUpdateTime = 'Chưa cập nhật';

// Đặt thời gian khởi động cố định (12:00 trưa 13/11/2025 GMT+7)
const serverStartTime = new Date('2025-11-13T05:00:00.000Z');

const CACHE_DURATION = 3600 * 1000; // 1 giờ

// Hàm format thời gian
const formatTime = (date) => {
    if (date === 'Chưa cập nhật') return date;
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

// Hàm lấy và phân tích dữ liệu CSV (Đã tích hợp thống kê và bỏ qua cache)
async function getAndParseData(shouldBypassCache = false) { 
    if (!shouldBypassCache && cachedData && new Date().getTime() - cachedData.cacheTime < CACHE_DURATION) {
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
        
        updateCount++;
        lastUpdateTime = new Date();
        cachedData = { data: filteredData, cacheTime: new Date().getTime() };
        
        return filteredData;

    } catch (error) {
        console.error("Lỗi khi tải hoặc phân tích CSV:", error);
        if (cachedData) return cachedData.data;
        throw new Error("Không thể tải hoặc xử lý dữ liệu nguồn.");
    }
}

// Hàm chính của Serverless Function
module.exports = async (req, res) => {
    let rawData = [];
    let loadError = null;
    
    const url = new URL(`http://dummy.com${req.url}`); 
    const shouldRefresh = url.searchParams.get('refresh') === 'true';
    
    try {
        rawData = await getAndParseData(shouldRefresh);
    } catch (e) {
        loadError = e.message;
    }
    
    const levelMap = rawData.reduce((acc, row) => {
        const level = row.level.toUpperCase().trim();
        if (!acc[level]) {
            acc[level] = { level: level, word_count: 0, topicSet: new Set(), topics: {} };
        }
        acc[level].word_count += 1;
        acc[level].topicSet.add(row.topic);
        
        if (row.topic) {
            const topicName = row.topic.trim();
            if (!acc[level].topics[topicName]) {
                acc[level].topics[topicName] = { topic: topicName, word_count: 0 };
            }
            acc[level].topics[topicName].word_count += 1;
        }
        
        return acc;
    }, {});
    
    const levelsArray = Object.values(levelMap)
        .map(item => ({
            level: item.level,
            word_count: item.word_count,
            topic_count: item.topicSet.size,
            topic_details: Object.values(item.topics).sort((a, b) => a.topic.localeCompare(b.topic))
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
        
        const currentLevel = levelsArray.find(item => item.level === testLevel);
        if (currentLevel) {
             topicsStatus = { success: true, message: "Thành công", data: currentLevel.topic_details };
        }

        if (topicsStatus.data.length > 0) {
              testTopic = topicsStatus.data[0].topic;
              
              const filteredData = rawData.filter(row => 
                  row.level && row.level.toUpperCase().trim() === testLevel &&
                  row.topic && row.topic.trim() === testTopic
              );
              lessonStatus = { success: true, message: "Thành công", data: filteredData.slice(0, 3) };
        }
        
        const allTopics = new Set(rawData.map(r => `${r.level}|${r.topic}`));
        globalStats = {
            totalLevels: levelsArray.length,
            totalTopics: allTopics.size,
            totalWords: rawData.length,
            levelStats: levelsArray
        };
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    const renderDataBox = (title, status, data, endpointPath) => {
        const isSuccess = status.success;
        const stateClass = isSuccess ? 'bg-green-100 border-green-500' : 'bg-red-100 border-red-500';
        const stateColor = isSuccess ? 'text-green-700' : 'text-red-700';

        const displayData = data ? data.slice(0, 3) : [];
        
        let sampleDataHtml = '';
        let totalItemsDisplay = isSuccess ? data.length : 0;
        let totalItemsLabel = 'Tổng số mục';

        if (title.startsWith('1. Danh sách Levels')) {
             sampleDataHtml = displayData.map(item => `
                <div class="bg-gray-50 p-2 rounded-lg text-xs">
                    <strong>Level:</strong> ${item.level}, 
                    <strong>Topic Count:</strong> ${item.topic_count || 'N/A'},
                    <strong>Word Count:</strong> ${item.word_count || 'N/A'}
                </div>
            `).join('');
            totalItemsLabel = 'Tổng số Level';
        } else if (title.startsWith('2. Danh sách Topics')) {
             sampleDataHtml = displayData.map(item => `
                <div class="bg-gray-50 p-2 rounded-lg text-xs">
                    <strong>Topic:</strong> ${item.topic}, 
                    <strong>Word Count:</strong> ${item.word_count || 'N/A'}
                </div>
            `).join('');
             totalItemsLabel = 'Tổng số Chủ đề trong Level test';
        } else if (title.startsWith('3. Nội dung Bài học')) {
             sampleDataHtml = displayData.map(item => `
                <div class="bg-gray-50 p-2 rounded-lg text-xs">
                    <strong>Word:</strong> ${item.word}, 
                    <strong>Level:</strong> ${item.level},
                    <strong>Topic:</strong> ${item.topic}
                </div>
            `).join('');
            totalItemsDisplay = rawData.filter(row => 
                row.level && row.level.toUpperCase().trim() === testLevel &&
                row.topic && row.topic.trim() === testTopic
            ).length;
            totalItemsLabel = 'Tổng số từ trong Bài học test';
        }


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
                        ${sampleDataHtml}
                        <p class="text-xs text-gray-500 mt-2">${totalItemsLabel}: ${totalItemsDisplay}</p>
                    </div>
                ` : ''}
            </div>
        `;
    };

    // Hàm render Cây Thư mục
    const renderTopicTree = (levels) => {
        // Tạo HTML cho các mục Level có thể collapse
        const contentHtml = levels.map((level, index) => `
            <div class="level-container bg-white rounded-xl shadow-lg mb-4">
                <div class="level-header p-4 cursor-pointer bg-purple-100 hover:bg-purple-200 rounded-t-xl" 
                     onclick="toggleLevelCollapse(this, '${level.level}')" 
                     data-level="${level.level}">
                    <h4 class="text-lg font-bold text-purple-800 flex justify-between items-center">
                        Level: ${level.level} (Tổng ${level.word_count} từ, ${level.topic_count} chủ đề)
                        <span class="collapse-icon text-xl transition-transform duration-300 transform rotate-0">▼</span>
                    </h4>
                </div>
                
                <div id="level-content-${level.level}" class="level-content-area p-4 hidden">
                    <div class="flex flex-wrap gap-2 mb-4">
                        <span class="text-sm font-medium text-gray-500 mr-2">Sắp xếp:</span>
                        <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="topic" data-direction="asc">Tên A-Z</button>
                        <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="topic" data-direction="desc">Tên Z-A</button>
                        <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="count" data-direction="desc">Từ (Nhiều > Ít)</button>
                        <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="count" data-direction="asc">Từ (Ít > Nhiều)</button>
                    </div>

                    <div id="topic-list-${level.level}" class="space-y-2">
                        ${level.topic_details.map(topic => `
                            <div class="topic-item bg-gray-50 p-3 rounded-lg hover:bg-gray-100 transition duration-150 flex justify-between items-center" data-topic-name="${topic.topic}" data-word-count="${topic.word_count}">
                                <span class="text-gray-700 font-medium">Chủ đề: ${topic.topic}</span>
                                <span class="text-sm font-bold text-purple-600">${topic.word_count} từ</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `).join('');

        // HTML và JS cho Collapse và Sort
        return `
            <div class="mt-8 mb-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Cấu trúc Dữ liệu Chi tiết (Cây Levels & Topics)</h2>
                <div id="levels-tree">
                    ${contentHtml}
                </div>
            </div>
            <script>
                // Hàm thu gọn/mở rộng Level
                function toggleLevelCollapse(header, levelName) {
                    const content = document.getElementById('level-content-' + levelName);
                    const icon = header.querySelector('.collapse-icon');
                    const levelContainer = header.closest('.level-container');
                    
                    if (content.classList.contains('hidden')) {
                        // Mở rộng
                        content.classList.remove('hidden');
                        icon.classList.remove('rotate-0');
                        icon.classList.add('rotate-180');
                        levelContainer.classList.add('rounded-b-none');
                    } else {
                        // Thu gọn
                        content.classList.add('hidden');
                        icon.classList.remove('rotate-180');
                        icon.classList.add('rotate-0');
                        levelContainer.classList.remove('rounded-b-none');
                    }
                }

                function sortTopics(levelName, sortBy, direction) {
                    const topicListElement = document.getElementById('topic-list-' + levelName);
                    const topicItems = Array.from(topicListElement.querySelectorAll('.topic-item'));

                    topicItems.sort((a, b) => {
                        let valA, valB;

                        if (sortBy === 'topic') {
                            valA = a.getAttribute('data-topic-name').toLowerCase();
                            valB = b.getAttribute('data-topic-name').toLowerCase();
                            if (direction === 'asc') return valA.localeCompare(valB);
                            return valB.localeCompare(valA);
                        } else if (sortBy === 'count') {
                            valA = parseInt(a.getAttribute('data-word-count'));
                            valB = parseInt(b.getAttribute('data-word-count'));
                            if (direction === 'asc') return valA - valB;
                            return valB - valA;
                        }
                        return 0;
                    });

                    // Xóa và chèn lại các mục đã sắp xếp
                    topicItems.forEach(item => topicListElement.appendChild(item));
                    
                    // Cập nhật trạng thái nút (màu)
                    document.querySelectorAll(\`[data-level="\${levelName}"].sort-button\`).forEach(btn => {
                        btn.classList.remove('bg-purple-500', 'text-white');
                        btn.classList.add('bg-gray-200', 'text-gray-800');
                    });
                    
                    // Tìm nút vừa được bấm để đổi màu
                    document.querySelector(\`[data-level="\${levelName}"][data-sort-by="\${sortBy}"][data-direction="\${direction}"]\`).classList.remove('bg-gray-200', 'text-gray-800');
                    document.querySelector(\`[data-level="\${levelName}"][data-sort-by="\${sortBy}"][data-direction="\${direction}"]\`).classList.add('bg-purple-500', 'text-white');
                }

                document.addEventListener('DOMContentLoaded', () => {
                    // Gán sự kiện cho các nút sắp xếp
                    document.querySelectorAll('.sort-button').forEach(button => {
                        button.addEventListener('click', function() {
                            const level = this.getAttribute('data-level');
                            const sortBy = this.getAttribute('data-sort-by');
                            const direction = this.getAttribute('data-direction');
                            sortTopics(level, sortBy, direction);
                        });
                    });
                    
                    // Mặc định sắp xếp theo Tên A-Z cho tất cả Levels khi load
                    // levelData.forEach(level => {
                    //     sortTopics(level.level, 'topic', 'asc');
                    // });
                });
             </script>
        `;
    };

    // Hàm render Footer
    const renderFooter = () => {
        const contactInfo = [
            { label: 'Facebook', value: 'hungnq188.2k5', link: 'https://www.facebook.com/hungnq188.2k5', icon: 'M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z' },
            { label: 'YouTube', value: '@nughnguyen', link: 'https://www.youtube.com/@nughnguyen', icon: 'M19.615 3.184c-3.197-.73-9.458-.73-12.656 0C3.12 3.864 1 6.848 1 12s2.12 8.136 5.959 8.816c3.198.73 9.457.73 12.656 0 3.84-1.28 5.959-4.264 5.959-8.816s-2.12-8.136-5.959-8.816zM10 15v-6l5 3-5 3z' },
            { label: 'Instagram', value: 'hq.hnug', link: 'https://www.instagram.com/hq.hnug', icon: 'M15 12c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3z' },
            { label: 'Discord', value: 'dsc.gg/thenoicez', link: 'https://dsc.gg/thenoicez', icon: 'M18.85 2.19c-2.32-.96-4.66-1.55-7.07-1.55-2.4 0-4.75.59-7.07 1.55-2.42 1.01-4.22 3.1-4.59 5.86-.54 8.01 4.5 13.79 4.5 13.79s2.47 1.62 5.66 1.62c3.19 0 5.66-1.62 5.66-1.62s5.04-5.78 4.5-13.79c-.37-2.76-2.17-4.85-4.59-5.86zM9 16c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zM15 16c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z' },
            { label: 'Email', value: 'hungnq.august.work@gmail.com', link: 'mailto:hungnq.august.work@gmail.com', icon: 'M3 8l7.89 5.26c.38.25.79.37 1.2.37.41 0 .82-.12 1.2-.37L21 8m-2 10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h14a2 2 0 012 2v10z' },
            { label: 'LinkedIn', value: 'hungnq-august', link: 'https://www.linkedin.com/in/hungnq-august/', icon: 'M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14zM8 17V9h3v8H8zM7 7.25A1.25 1.25 0 005.75 6a1.25 1.25 0 00-1.25 1.25 1.25 1.25 0 001.25 1.25 1.25 1.25 0 001.25-1.25z' },
            { label: 'TikTok', value: 'nq.hnug', link: 'https://www.tiktok.com/@nq.hnug', icon: 'M20 17.5a.5.5 0 01-.5.5H16V14h3v3.5a.5.5 0 01-.5.5z' },
            { label: 'Phone', value: '0388205003 / 0923056036', link: 'tel:0388205003', icon: 'M3 5a1 1 0 011-1h3a1 1 0 01.993.883l.1 1.766A1 1 0 017.02 8.01l-1.04-.4a.5.5 0 00-.5.127 8.003 8.003 0 005.748 5.748.5.5 0 00.127-.501l-.4-1.04a1 1 0 011.028-1.07l1.766.1a1 1 0 01.883.993v3a1 1 0 01-1 1H4a1 1 0 01-1-1V5z' },
            { label: 'Zalo', value: 'Hưng (0923056036)', link: 'https://zalo.me/0923056036', icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.2 13h-2.4c-.662 0-1.2-.538-1.2-1.2V9.2c0-.662.538-1.2 1.2-1.2h2.4c.662 0 1.2.538 1.2 1.2v4.6c0 .662-.538 1.2-1.2 1.2z' },
            { label: 'Website', value: 'guns.lol/nguyenquochung', link: 'https://guns.lol/nguyenquochung', icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z' }
        ];

        return `
            <footer class="mt-16 pt-8 pb-4 bg-gray-900 text-white border-t-4 border-purple-600">
                <div class="container mx-auto px-4 sm:px-8">
                    <div class="text-center mb-6">
                        <span class="text-xs text-gray-400 block mb-2">Developed & Maintained by</span>
                        <div class="inline-block text-2xl font-extrabold tracking-wider text-white">
                            <span class="quoc-hung-text">Quoc Hung</span>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-5 gap-6 text-sm">
                        ${contactInfo.map(item => `
                            <div class="flex items-start space-x-2">
                                <svg class="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"></path></svg>
                                <div>
                                    <p class="font-semibold text-gray-300">${item.label}</p>
                                    <a href="${item.link}" target="_blank" class="text-xs text-gray-400 hover:text-purple-300 transition duration-150 break-all">${item.value}</a>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <p class="text-center text-xs text-gray-500 mt-8 pt-4 border-t border-gray-700">
                        &copy; ${new Date().getFullYear()} Quoc Hung. All rights reserved.
                    </p>
                </div>
                <style>
                    @keyframes neonPulse {
                        0%, 100% { color: #f3e8ff; text-shadow: 0 0 5px #9333ea, 0 0 10px #9333ea; }
                        50% { color: #ffffff; text-shadow: 0 0 10px #a78bfa, 0 0 20px #8b5cf6; }
                    }
                    .quoc-hung-text {
                        animation: neonPulse 2s ease-in-out infinite;
                        text-transform: uppercase;
                    }
                </style>
            </footer>
        `;
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gumballz API Dashboard | Quoc Hung</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body { font-family: 'Inter', sans-serif; background-color: #f4f7f9; }
                .text-purple-600 { color: #9333EA; }
                .bg-purple-100 { background-color: #F3E8FF; }
                /* Animation cho nút bấm */
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin { animation: spin 1s linear infinite; }
            </style>
        </head>
        <body>
            <div class="container mx-auto p-4 sm:p-8">
                <header class="mb-8">
                    <div class="flex justify-between items-center border-b-4 border-purple-200 pb-2">
                        <h1 class="text-4xl font-extrabold text-purple-600">
                            Gumballz API Dashboard
                        </h1>
                        <button id="refresh-button" class="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 flex items-center text-sm">
                            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m15.356 2H15m-3-4v5h.582m-.582 0l-1.356-1.356m1.356 1.356L15 8.644m-3 3l-1.356 1.356m1.356-1.356l1.356-1.356M4 13a8.001 8.001 0 0015.356 2"></path></svg>
                            Cập nhật Ngay
                        </button>
                    </div>
                    <p class="text-gray-600 mt-2">Trạng thái đồng bộ dữ liệu từ Google Sheet CSV.</p>
                </header>
                
                <script>
                    document.getElementById('refresh-button').addEventListener('click', function() {
                        const button = this;
                        button.disabled = true;
                        button.innerHTML = '<svg class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m15.356 2H15m-3-4v5h.582m-.582 0l-1.356-1.356m1.356 1.356L15 8.644m-3 3l-1.356 1.356m1.356-1.356l1.356-1.356M4 13a8.001 8.001 0 0015.356 2"></path></svg> Đang tải...';
                        
                        const currentUrl = new URL(window.location.href);
                        currentUrl.searchParams.set('refresh', 'true');
                        
                        window.location.href = currentUrl.toString();
                    });
                </script>

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

                <h2 class="text-2xl font-bold text-gray-800 mb-4">Kiểm tra Endpoints (Kiểm tra API tự động)</h2>
                
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

                ${renderTopicTree(levelsArray)}

            </div>
            ${renderFooter()}
        </body>
        </html>
    `;

    res.status(200).send(htmlContent);
};