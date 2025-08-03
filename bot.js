const { Telegraf, Markup } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { generateTTS } = require('./tts-service');
const { createVideo, createSimpleVideo, checkFFmpeg } = require('./video-service');

// Конфигурация бота
const BOT_TOKEN = '6231952257:AAG79igBRce79l-ZIunBHsOIzEKwmZuy-Tk';
const bot = new Telegraf(BOT_TOKEN);

// Создаем папки для хранения файлов
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Инициализация папок
fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(OUTPUT_DIR);

// Хранилище данных пользователей
const userData = new Map();

// Клавиатура с кнопками
const mainKeyboard = Markup.keyboard([
    ['📷 Добавить картинку с телефона'],
    ['📝 Добавить текст']
]).resize();



// Обработчик команды /start
bot.start((ctx) => {
    const userId = ctx.from.id;
    
    // Инициализируем данные пользователя
    userData.set(userId, {
        images: [],
        text: '',
        state: 'idle'
    });
    
    ctx.reply('Поработаем?! =)', mainKeyboard);
});

// Обработчик кнопки "Добавить картинку с телефона"
bot.hears('📷 Добавить картинку с телефона', (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', state: 'idle' };
    
    user.state = 'waiting_for_image';
    userData.set(userId, user);
    
    ctx.reply('Пожалуйста, отправьте изображение 📸', Markup.keyboard([['🔙 Назад в меню']]).resize());
});

// Обработчик кнопки "Добавить текст"
bot.hears('📝 Добавить текст', (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', state: 'idle' };
    
    user.state = 'waiting_for_text';
    userData.set(userId, user);
    
    ctx.reply('Пожалуйста, введите текст (до 200 символов):', Markup.keyboard([['🔙 Назад в меню']]).resize());
});

// Обработчик кнопки "Назад в меню"
bot.hears('🔙 Назад в меню', (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', state: 'idle' };
    
    user.state = 'idle';
    userData.set(userId, user);
    
    ctx.reply('Главное меню:', mainKeyboard);
});

// Обработчик получения изображений
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId);
    
    if (!user || user.state !== 'waiting_for_image') {
        return;
    }
    
    try {
        // Получаем файл изображения
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Берем самое большое изображение
        const file = await ctx.telegram.getFile(photo.file_id);
        
        // Скачиваем изображение
        const imagePath = path.join(UPLOADS_DIR, `image_${uuidv4()}.jpg`);
        const response = await axios({
            method: 'GET',
            url: `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`,
            responseType: 'arraybuffer'
        });
        
        await fs.writeFile(imagePath, response.data);
        
        // Добавляем изображение в данные пользователя
        user.images.push(imagePath);
        user.state = 'idle';
        userData.set(userId, user);
        
        ctx.reply(`Изображение добавлено! Всего изображений: ${user.images.length}`, mainKeyboard);
        
        // Проверяем, можно ли создать видео
        if (user.images.length > 0 && user.text) {
            ctx.reply('🎬 Готово! Создаю видео...');
            await createAndSendVideo(ctx, userId);
        }
        
    } catch (error) {
        console.error('Ошибка обработки изображения:', error);
        ctx.reply('❌ Ошибка при обработке изображения. Попробуйте еще раз.', mainKeyboard);
    }
});

// Обработчик получения текста
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId);
    
    if (!user || user.state !== 'waiting_for_text') {
        return;
    }
    
    const text = ctx.message.text;
    
    if (text.length > 200) {
        ctx.reply('❌ Текст слишком длинный! Максимум 200 символов.', mainKeyboard);
        return;
    }
    
    // Сохраняем текст
    user.text = text;
    user.state = 'idle';
    userData.set(userId, user);
    
    ctx.reply(`Текст добавлен: "${text}"`, mainKeyboard);
    
    // Проверяем, можно ли создать видео
    if (user.images.length > 0 && user.text) {
        ctx.reply('🎬 Готово! Создаю видео...');
        await createAndSendVideo(ctx, userId);
    }
});

// Функция создания и отправки видео
async function createAndSendVideo(ctx, userId) {
    try {
        const user = userData.get(userId);
        
        if (!user || !user.images.length || !user.text) {
            return;
        }
        
        // Проверяем доступность FFmpeg
        const ffmpegAvailable = await checkFFmpeg();
        if (!ffmpegAvailable) {
            ctx.reply('❌ FFmpeg не найден. Установите FFmpeg для создания видео.', mainKeyboard);
            return;
        }
        
        let outputPath;
        
        try {
            // Генерируем TTS аудио
            ctx.reply('🎵 Генерирую озвучку...');
            const audioPath = await generateTTS(user.text, 'female', UPLOADS_DIR);
            
            // Создаем видео с аудио
            ctx.reply('🎬 Создаю видео...');
            outputPath = path.join(OUTPUT_DIR, `video_${uuidv4()}.mp4`);
            await createVideo(user.images, audioPath, user.text, outputPath);
            
            // Удаляем аудио файл
            setTimeout(async () => {
                try {
                    await fs.remove(audioPath);
                } catch (error) {
                    console.error('Ошибка удаления аудио файла:', error);
                }
            }, 30000);
            
        } catch (error) {
            console.error('Ошибка создания видео с аудио:', error);
            
            // Fallback: создаем видео без аудио
            ctx.reply('⚠️ Не удалось создать озвучку. Создаю видео без звука...');
            outputPath = path.join(OUTPUT_DIR, `video_simple_${uuidv4()}.mp4`);
            await createSimpleVideo(user.images, user.text, outputPath);
        }
        
        // Отправляем видео
        ctx.reply('📤 Отправляю видео...');
        await ctx.replyWithVideo({ source: outputPath }, { 
            caption: '🎬 Ваше видео готово!',
            reply_markup: mainKeyboard.reply_markup 
        });
        
        // Очищаем данные пользователя
        userData.set(userId, { images: [], text: '', state: 'idle' });
        
        // Удаляем видео файл через минуту
        setTimeout(async () => {
            try {
                await fs.remove(outputPath);
            } catch (error) {
                console.error('Ошибка удаления видео файла:', error);
            }
        }, 60000);
        
    } catch (error) {
        console.error('Ошибка создания видео:', error);
        ctx.reply('❌ Ошибка при создании видео. Попробуйте еще раз.', mainKeyboard);
    }
}

// Обработчик ошибок
bot.catch((err, ctx) => {
    console.error('Ошибка бота:', err);
    ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.', mainKeyboard);
});

// Запуск бота
async function startBot() {
    try {
        // Проверяем FFmpeg
        console.log('🔍 Проверяю FFmpeg...');
        const ffmpegAvailable = await checkFFmpeg();
        
        if (!ffmpegAvailable) {
            console.log('⚠️ FFmpeg не найден. Видео будет создаваться без звука.');
        }
        
        // Запускаем бота
        await bot.launch();
        
        console.log('🤖 Бот запущен!');
        console.log('📱 Имя бота: gptchat_mac_bot');
        console.log('🔗 Токен:', BOT_TOKEN);
        console.log('📁 Папки созданы:', { uploads: UPLOADS_DIR, output: OUTPUT_DIR });
        
    } catch (error) {
        console.error('❌ Ошибка запуска бота:', error);
    }
}

startBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 