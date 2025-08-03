const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Генерация SRT субтитров с равномерным разбиением текста
 */
async function generateSubtitles(text, duration, outputDir) {
    const srtPath = path.join(outputDir, `subtitles_${uuidv4()}.srt`);
    const cleanText = text.trim();
    if (!cleanText) throw new Error('Текст для субтитров пустой');
    const maxCharsPerSubtitle = 45;
    const words = cleanText.split(' ');
    const subtitles = [];
    let currentSubtitle = '';
    for (const word of words) {
        if ((currentSubtitle + ' ' + word).length <= maxCharsPerSubtitle) {
            currentSubtitle = currentSubtitle ? currentSubtitle + ' ' + word : word;
        } else {
            if (currentSubtitle) subtitles.push(currentSubtitle);
            currentSubtitle = word;
        }
    }
    if (currentSubtitle) subtitles.push(currentSubtitle);
    if (subtitles.length > 6) {
        const combined = [];
        for (let i = 0; i < subtitles.length; i += 2) {
            if (i + 1 < subtitles.length) combined.push(subtitles[i] + ' ' + subtitles[i + 1]);
            else combined.push(subtitles[i]);
        }
        subtitles.splice(0, subtitles.length, ...combined);
    }
    const timePerSubtitle = duration / subtitles.length;
    let srtContent = '';
    for (let i = 0; i < subtitles.length; i++) {
        const startTime = i * timePerSubtitle;
        const endTime = (i + 1) * timePerSubtitle;
        srtContent += `${i + 1}\n${formatTimecode(startTime)} --> ${formatTimecode(endTime)}\n${subtitles[i]}\n\n`;
    }
    await fs.writeFile(srtPath, srtContent, 'utf8');
    console.log(`✅ SRT субтитры созданы: ${srtPath}`);
    return srtPath;
}

function formatTimecode(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/**
 * Создание видео с изображениями и аудио (15 секунд, вертикальный формат 720x1280, субтитры)
 */
async function createVideo(imagePaths, audioPath, text, outputPath) {
    return new Promise(async (resolve, reject) => {
        console.log('🎬 Начинаю создание видео (вертикальный формат 720x1280)...');
        try {
            if (!(await fs.pathExists(audioPath))) return reject(new Error('Аудиофайл не найден: ' + audioPath));
            if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
            const subtitlesPath = await generateSubtitles(text, 15, path.dirname(outputPath));
            let command = ffmpeg();
            imagePaths.forEach(p => command.input(p));
            command.input(audioPath);

            // Вставляем фильтр subtitles прямо в filter_complex!
            const subtitleFilter = `subtitles='${subtitlesPath}':force_style='FontName=Arial,FontSize=16,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2,MarginV=50'`;
            const filterComplex = imagePaths.length === 1
                ? `[0:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,${subtitleFilter}[v];[1:a]atrim=duration=15,asetpts=PTS-STARTPTS[a]`
                : (() => {
                    let filters = '';
                    imagePaths.forEach((_, i) => {
                        const f = `[${i}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,${subtitleFilter}[v${i}]`;
                        filters += i === 0 ? f : `;${f}`;
                    });
                    const concat = imagePaths.map((_, i) => `[v${i}]`).join('');
                    return `${filters};${concat}concat=n=${imagePaths.length}:v=1:a=0[v];[1:a]atrim=duration=15,asetpts=PTS-STARTPTS[a]`;
                })();

            command
                .complexFilter(filterComplex, ['v', 'a'])
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset fast',
                    '-crf 23',
                    '-b:a 128k',
                    '-t 20',
                    '-movflags +faststart'
                ])
                .output(outputPath)
                .on('start', cmd => console.log('🚀 FFmpeg:', cmd))
                .on('progress', p => console.log(`📊 ${p.percent?.toFixed(1)}%`))
                .on('end', async () => {
                    try { await fs.remove(subtitlesPath); } catch (e) { console.warn('⚠️ Не удалён SRT:', e.message); }
                    if (!(await fs.pathExists(outputPath))) return reject(new Error('Файл видео не создан'));
                    const stats = await fs.stat(outputPath);
                    if (stats.size < 1024) return reject(new Error('Видео файл пустой'));
                    console.log('✅ Видео с озвучкой готово (720x1280):', outputPath);
                    resolve(outputPath);
                })
                .on('error', async (err) => {
                    try { await fs.remove(subtitlesPath); } catch (e) { console.warn('⚠️ Не удалён SRT:', e.message); }
                    console.error('❌ Ошибка FFmpeg:', err.message || err);
                    reject(err);
                })
                .run();
        } catch (err) {
            console.error('❌ Ошибка:', err);
            reject(err);
        }
    });
}

/**
 * Создание простого видео без аудио (вертикальный формат 720x1280)
 */
async function createSimpleVideo(imagePaths, text, outputPath) {
    return new Promise(async (resolve, reject) => {
        console.log('🎬 Создаю простое видео без аудио (720x1280)...');
        try {
            if (!(await fs.pathExists(imagePaths[0]))) return reject(new Error('Изображение не найдено'));
            if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
            const subtitlesPath = await generateSubtitles(text, 15, path.dirname(outputPath));
            ffmpeg(imagePaths[0])
                .videoFilters([
                    'scale=720:1280:force_original_aspect_ratio=decrease',
                    'pad=720:1280:(ow-iw)/2:(oh-ih)/2',
                    `subtitles='${subtitlesPath}':force_style='FontName=Arial,FontSize=16,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2,MarginV=50'`
                ])
                .videoCodec('libx264')
                .outputOptions([
                    '-preset fast',
                    '-crf 23',
                    '-t 20'
                ])
                .output(outputPath)
                .on('end', async () => {
                    try { await fs.remove(subtitlesPath); } catch (e) { console.warn('⚠️ Не удалён SRT:', e.message); }
                    console.log('✅ Простое видео создано (720x1280):', outputPath);
                    resolve(outputPath);
                })
                .on('error', async (err) => {
                    try { await fs.remove(subtitlesPath); } catch (e) { console.warn('⚠️ Не удалён SRT:', e.message); }
                    console.error('❌ Ошибка:', err.message || err);
                    reject(err);
                })
                .run();
        } catch (err) {
            console.error('❌ Ошибка:', err);
            reject(err);
        }
    });
}

function checkFFmpeg() {
    return new Promise((resolve) => {
        ffmpeg.getAvailableFormats((err, formats) => {
            if (err) {
                console.error('❌ FFmpeg не найден:', err.message);
                resolve(false);
            } else {
                console.log('✅ FFmpeg доступен');
                resolve(true);
            }
        });
    });
}

function getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata);
        });
    });
}

module.exports = {
    createVideo,
    createSimpleVideo,
    checkFFmpeg,
    getVideoInfo,
    generateSubtitles
};
