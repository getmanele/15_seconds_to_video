const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Создание видео с изображениями и аудио (15 секунд)
 */
async function createVideo(imagePaths, audioPath, text, outputPath) {
    return new Promise(async (resolve, reject) => {
        console.log('🎬 Начинаю создание видео...');
        console.log(`📷 Изображений: ${imagePaths.length}`);
        console.log(`🎵 Аудио файл: ${audioPath}`);
        console.log(`📝 Текст: "${text}"`);

        try {
            if (!(await fs.pathExists(audioPath))) {
                return reject(new Error('Аудиофайл не найден: ' + audioPath));
            }

            // Удаляем старый файл
            if (await fs.pathExists(outputPath)) {
                await fs.remove(outputPath);
            }

            // Подготавливаем текст: убираем кавычки, переносы, ограничиваем
            const cleanText = text
                .replace(/"/g, '')
                .replace(/'/g, '')
                .replace(/\n/g, ' ')
                .replace(/\r/g, ' ')
                .trim()
                .substring(0, 200);

            const textFilePath = path.join(path.dirname(outputPath), `text_${uuidv4()}.txt`);
            await fs.writeFile(textFilePath, cleanText, 'utf8');

            let command = ffmpeg();

            // Добавляем изображения
            imagePaths.forEach(p => command.input(p));
            command.input(audioPath); // аудио

            // Фильтр
            const filterComplex = imagePaths.length === 1
                ? `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,drawtext=textfile='${textFilePath}':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=h-th-20:shadowcolor=black:shadowx=2:shadowy=2[v];[1:a]atrim=duration=15,asetpts=PTS-STARTPTS[a]`
                : (() => {
                    let filters = '';
                    imagePaths.forEach((_, i) => {
                        const f = `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,drawtext=textfile='${textFilePath}':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=h-th-20:shadowcolor=black:shadowx=2:shadowy=2[v${i}]`;
                        filters += i === 0 ? f : `;${f}`;
                    });
                    const concat = imagePaths.map((_, i) => `[v${i}]`).join('');
                    return `${filters};${concat}concat=n=${imagePaths.length}:v=1:a=0[v];[1:a]atrim=duration=15,asetpts=PTS-STARTPTS[a]`;
                })();

            // Ключевые исправления:
            // - Убраны .outputOptions с -c:v и -c:a
            // - Используем .videoCodec() и .audioCodec()
            // - Только один .map()
            // - Используем .output(), а не .save()
            command
                .complexFilter(filterComplex, ['v', 'a'])
                .map('[v]')
                .map('[a]')
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset fast',
                    '-crf 23',
                    '-b:a 128k',
                    '-t 15',
                    '-movflags +faststart'
                ])
                .output(outputPath)
                .on('start', cmd => console.log('🚀 FFmpeg:', cmd))
                .on('progress', p => console.log(`📊 ${p.percent?.toFixed(1)}%`))
                .on('end', async () => {
                    try {
                        await fs.remove(textFilePath);
                    } catch (e) {
                        console.warn('⚠️ Не удалён текст:', e.message);
                    }

                    // Проверим, что файл создан и не пустой
                    if (!(await fs.pathExists(outputPath))) {
                        return reject(new Error('Файл видео не создан'));
                    }

                    const stats = await fs.stat(outputPath);
                    if (stats.size < 1024) {
                        return reject(new Error('Видео файл пустой'));
                    }

                    console.log('✅ Видео с озвучкой готово:', outputPath);
                    resolve(outputPath);
                })
                .on('error', async (err) => {
                    try {
                        await fs.remove(textFilePath);
                    } catch (e) {
                        console.warn('⚠️ Не удалён текст:', e.message);
                    }
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
 * Создание простого видео без аудио
 */
async function createSimpleVideo(imagePaths, text, outputPath) {
    return new Promise(async (resolve, reject) => {
        console.log('🎬 Создаю простое видео без аудио...');

        try {
            if (!(await fs.pathExists(imagePaths[0]))) {
                return reject(new Error('Изображение не найдено'));
            }

            if (await fs.pathExists(outputPath)) {
                await fs.remove(outputPath);
            }

            const cleanText = text
                .replace(/"/g, '')
                .replace(/'/g, '')
                .replace(/\n/g, ' ')
                .substring(0, 200);

            const textFilePath = path.join(path.dirname(outputPath), `text_simple_${uuidv4()}.txt`);
            await fs.writeFile(textFilePath, cleanText, 'utf8');

            ffmpeg(imagePaths[0])
                .videoFilters([
                    'scale=1280:720:force_original_aspect_ratio=decrease',
                    'pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                    `drawtext=textfile='${textFilePath}':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=h-th-20:shadowcolor=black:shadowx=2:shadowy=2`
                ])
                .videoCodec('libx264')
                .outputOptions([
                    '-preset fast',
                    '-crf 23',
                    '-t 15'
                ])
                .output(outputPath)
                .on('end', async () => {
                    try {
                        await fs.remove(textFilePath);
                    } catch (e) {
                        console.warn('⚠️ Не удалён текст:', e.message);
                    }
                    console.log('✅ Простое видео создано:', outputPath);
                    resolve(outputPath);
                })
                .on('error', async (err) => {
                    try {
                        await fs.remove(textFilePath);
                    } catch (e) {
                        console.warn('⚠️ Не удалён текст:', e.message);
                    }
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

/**
 * Проверка доступности FFmpeg
 */
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

/**
 * Получение информации о видео файле
 */
function getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                resolve(metadata);
            }
        });
    });
}

module.exports = {
    createVideo,
    createSimpleVideo,
    checkFFmpeg,
    getVideoInfo
};
