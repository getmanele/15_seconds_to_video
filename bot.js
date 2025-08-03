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

// Функция создания динамической клавиатуры
function createMainKeyboard(user = {}) {
    const hasImages = user.images && user.images.length > 0;
    const hasText = user.text && user.text.trim();
    const selectedVoice = user.voice || 'female';
    
    const buttons = [
        [`📷 Добавить картинку${hasImages ? ' ✅' : ''}`],
        [`📝 Добавить текст${hasText ? ' ✅' : ''}`],
        [`🎵 Выбор голоса (${selectedVoice === 'female' ? 'женский' : 'мужской'})`]
    ];
    
    return Markup.keyboard(buttons).resize();
}

// Клавиатура выбора голоса
const voiceKeyboard = Markup.keyboard([
    ['🎵 Женский голос'],
    ['🎵 Мужской голос'],
    ['🔙 Назад в меню']
]).resize();

// Обработчик команды /start
bot.start((ctx) => {
    const userId = ctx.from.id;
    
    // Инициализируем данные пользователя
    const user = {
        images: [],
        text: '',
        voice: 'female', // голос по умолчанию
        state: 'idle'
    };
    userData.set(userId, user);
    
    ctx.reply('Поработаем?! =)', createMainKeyboard(user));
});

// Обработчик кнопки "Добавить картинку с телефона"
bot.hears(/📷 Добавить картинку/, (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
    
    user.state = 'waiting_for_image';
    userData.set(userId, user);
    
    ctx.reply('Пожалуйста, отправьте изображение 📸', Markup.keyboard([['🔙 Назад в меню']]).resize());
});

// Обработчик кнопки "Добавить текст"
bot.hears(/📝 Добавить текст/, (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
    
    user.state = 'waiting_for_text';
    userData.set(userId, user);
    
    ctx.reply('Пожалуйста, введите текст (до 200 символов):', Markup.keyboard([['🔙 Назад в меню']]).resize());
});

// Обработчик кнопки "Выбор голоса"
bot.hears(/🎵 Выбор голоса/, (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
    
    user.state = 'choosing_voice';
    userData.set(userId, user);
    
    ctx.reply('Выберите голос для озвучки:', voiceKeyboard);
});

// Обработчики выбора голоса
bot.hears('🎵 Женский голос', (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
    
    user.voice = 'female';
    user.state = 'idle';
    userData.set(userId, user);
    
    ctx.reply('✅ Выбран женский голос', createMainKeyboard(user));
});

bot.hears('🎵 Мужской голос', (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
    
    user.voice = 'male';
    user.state = 'idle';
    userData.set(userId, user);
    
    ctx.reply('✅ Выбран мужской голос', createMainKeyboard(user));
});

// Обработчик кнопки "Назад в меню"
bot.hears('🔙 Назад в меню', (ctx) => {
    const userId = ctx.from.id;
    const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
    
    user.state = 'idle';
    userData.set(userId, user);
    
    ctx.reply('Главное меню:', createMainKeyboard(user));
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
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Самое большое изображение
        const file = await ctx.telegram.getFile(photo.file_id);
        
        // Скачиваем изображение
        const imagePath = path.join(UPLOADS_DIR, `image_${uuidv4()}.jpg`);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const response = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'arraybuffer'
        });
        
        await fs.writeFile(imagePath, response.data);
        
        // Добавляем изображение в данные пользователя
        user.images.push(imagePath);
        user.state = 'idle';
        userData.set(userId, user);
        
        ctx.reply(`Изображение добавлено! Всего изображений: ${user.images.length}`, createMainKeyboard(user));
        
        // Проверяем, можно ли создать видео
        if (user.images.length > 0 && user.text) {
            ctx.reply('🎬 Готово! Создаю видео...');
            await createAndSendVideo(ctx, userId);
        }
        
    } catch (error) {
        console.error('Ошибка обработки изображения:', error);
        ctx.reply('❌ Ошибка при обработке изображения. Попробуйте еще раз.', createMainKeyboard(user));
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
        ctx.reply('❌ Текст слишком длинный! Максимум 200 символов.', createMainKeyboard(user));
        return;
    }
    
    // Сохраняем текст
    user.text = text;
    user.state = 'idle';
    userData.set(userId, user);
    
    ctx.reply(`✅ Текст принят: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`, createMainKeyboard(user));
    
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
            ctx.reply('❌ FFmpeg не найден. Установите FFmpeg для создания видео.', createMainKeyboard(user));
            return;
        }
        
        let outputPath;
        
        try {
            // Генерируем TTS аудио с выбранным голосом
            ctx.reply(`🎵 Генерирую озвучку (${user.voice === 'female' ? 'женский' : 'мужской'} голос)...`);
            const audioPath = await generateTTS(user.text, user.voice, UPLOADS_DIR);
            
            // Проверяем, что аудиофайл создан
            if (!(await fs.pathExists(audioPath))) {
                throw new Error('Файл TTS не был создан');
            }
            
            // Создаем видео с аудио (15 секунд, вертикальный формат)
            ctx.reply('🎬 Создаю 15-секундное видео с озвучкой (720x1280)...');
            outputPath = path.join(OUTPUT_DIR, `video_${uuidv4()}.mp4`);
            await createVideo(user.images, audioPath, user.text, outputPath);
            
        } catch (error) {
            console.error('Ошибка создания видео с аудио:', error);
            
            // Fallback: видео без звука
            ctx.reply('⚠️ Не удалось создать озвучку. Создаю видео без звука...');
            outputPath = path.join(OUTPUT_DIR, `video_simple_${uuidv4()}.mp4`);
            await createSimpleVideo(user.images, user.text, outputPath);
        }
        
        // Проверяем, что видео создано
        if (!(await fs.pathExists(outputPath))) {
            throw new Error('Видео не было создано');
        }
        
        // Отправляем видео
        ctx.reply('📤 Отправляю видео...');
        await ctx.replyWithVideo({ source: outputPath }, { 
            caption: '🎬 Ваше видео готово! (15 секунд, 720x1280)',
            reply_markup: createMainKeyboard(user).reply_markup 
        });
        
        // Очищаем данные пользователя но сохраняем выбранный голос
        userData.set(userId, { images: [], text: '', voice: user.voice, state: 'idle' });
        
        // Удаляем видео файл через минуту
        setTimeout(async () => {
            try {
                await fs.remove(outputPath);
                console.log(`Видео файл удалён: ${outputPath}`);
            } catch (error) {
                console.error('Ошибка удаления видео файла:', error);
            }
        }, 60000);
        
    } catch (error) {
        console.error('Ошибка создания видео:', error);
        const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
        ctx.reply('❌ Ошибка при создании видео. Попробуйте еще раз.', createMainKeyboard(user));
    }
}

// Обработчик ошибок
bot.catch((err, ctx) => {
    console.error('Ошибка бота:', err);
    const userId = ctx.from?.id;
    const user = userData.get(userId) || { images: [], text: '', voice: 'female', state: 'idle' };
    ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.', createMainKeyboard(user));
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
        console.log('📺 Формат видео: 720x1280 (вертикальный)');
        console.log('🎵 Поддержка голосов: мужской/женский');
        
    } catch (error) {
        console.error('❌ Ошибка запуска бота:', error);
    }
}

startBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
