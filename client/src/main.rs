use eframe::{egui, Frame};
use egui::{Color32, Context, RichText, ScrollArea, TextEdit, Window};
use serde::Deserialize;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command};
use sysinfo::System;
use tokio::runtime::Runtime;

#[derive(PartialEq)]
enum AppState {
    Splash,
    Setup,
    PhoneInput,
    CodeInput,
    MainChat,
}

#[derive(Clone, Deserialize)]
struct Chat {
    id: i64,
    name: String,
    #[serde(rename = "type")]
    chat_type: String,
    unread: i32,
}

#[derive(Clone, Deserialize)]
struct ChatListResponse {
    chats: Vec<Chat>,
}

#[derive(Clone, Deserialize)]
struct Message {
    id: i64,
    sender: String,
    text: Option<String>,
    date: String,
    media: Option<String>,
}

#[derive(Clone, Deserialize)]
struct MessagesResponse {
    chat_id: i64,
    chat_name: String,
    messages: Vec<Message>,
}

struct UranApp {
    state: AppState,
    api_id: String,
    api_hash: String,
    phone: String,
    code: String,
    error_message: Option<String>,
    backend_process: Option<Child>,
    chats: Vec<Chat>,
    selected_chat: Option<Chat>,
    messages: Vec<Message>,
    current_chat_name: String,
    new_message: String,
    loading_chats: bool,
    loading_messages: bool,
}

impl Default for UranApp {
    fn default() -> Self {
        Self {
            state: AppState::Splash,
            api_id: String::new(),
            api_hash: String::new(),
            phone: String::new(),
            code: String::new(),
            error_message: None,
            backend_process: None,
            chats: Vec::new(),
            selected_chat: None,
            messages: Vec::new(),
            current_chat_name: String::new(),
            new_message: String::new(),
            loading_chats: false,
            loading_messages: false,
        }
    }
}

impl UranApp {
    fn get_config_dir() -> PathBuf {
        let appdata = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        appdata.join(".URAN").join("api")
    }
    
    fn get_python_path() -> PathBuf {
        Self::get_config_dir().join("python").join("pythonw.exe")
    }
    
    fn save_telegram_config(&self) -> Result<(), String> {
        let config_dir = Self::get_config_dir();
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        
        let config_path = config_dir.join("tg_config.ini");
        let content = format!("[Telegram]\napi_id = {}\napi_hash = {}\n", self.api_id, self.api_hash);
        
        let mut file = File::create(config_path).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        
        Ok(())
    }
    
    fn start_backend(&mut self) -> Result<(), String> {
        let config_dir = Self::get_config_dir();
        let python_path = Self::get_python_path();
        let script_path = config_dir.join("tg.py");
        
        if !python_path.exists() {
            return Err("Python backend not found".to_string());
        }
        
        let child = Command::new(python_path)
            .arg(&script_path)
            .current_dir(&config_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        
        self.backend_process = Some(child);
        Ok(())
    }
    
	fn kill_backend(&mut self) {
		if let Some(mut child) = self.backend_process.take() {
			let _ = child.kill();
			let _ = child.wait();
		}
    
		let s = System::new_all();
		for process in s.processes().values() {
			let cmd = process.cmd();
			let cmd_str: String = cmd.join(" ");
			if cmd_str.contains("tg.py") {
				let _ = process.kill();
			}
		}
	}
    fn make_request(&self, url: &str) -> Result<String, String> {
        let rt = Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            match reqwest::get(url).await {
                Ok(response) => {
                    let text = response.text().await.unwrap_or_default();
                    Ok(text)
                }
                Err(e) => Err(e.to_string()),
            }
        })
    }
    
    fn load_chats(&mut self) {
        self.loading_chats = true;
        match self.make_request("http://localhost:9870/chat_list") {
            Ok(response) => {
                if let Ok(chat_list) = serde_json::from_str::<ChatListResponse>(&response) {
                    self.chats = chat_list.chats;
                }
            }
            Err(e) => {
                self.error_message = Some(format!("Load chats error: {}", e));
            }
        }
        self.loading_chats = false;
    }
    
    fn load_messages(&mut self, chat_id: i64) {
        self.loading_messages = true;
        let url = format!("http://localhost:9870/get_messages/id?id={}&limit=100", chat_id);
        match self.make_request(&url) {
            Ok(response) => {
                if let Ok(msg_response) = serde_json::from_str::<MessagesResponse>(&response) {
                    let mut messages = msg_response.messages;
                    messages.reverse();
                    self.messages = messages;
                    self.current_chat_name = msg_response.chat_name;
                }
            }
            Err(e) => {
                self.error_message = Some(format!("Load messages error: {}", e));
            }
        }
        self.loading_messages = false;
    }
    
    fn send_message(&mut self, chat_id: i64) {
        if self.new_message.is_empty() {
            return;
        }
        
        let url = format!("http://localhost:9870/send_message/id?id={}&text={}", 
            chat_id, urlencoding::encode(&self.new_message));
        
        match self.make_request(&url) {
            Ok(_) => {
                self.new_message.clear();
                self.load_messages(chat_id);
            }
            Err(e) => {
                self.error_message = Some(format!("Send error: {}", e));
            }
        }
    }
    
    fn start_setup(&mut self) {
        if self.api_id.is_empty() || self.api_hash.is_empty() {
            self.error_message = Some("Заполните все поля".to_string());
            return;
        }
        
        if let Err(e) = self.save_telegram_config() {
            self.error_message = Some(e);
            return;
        }
        
        if let Err(e) = self.start_backend() {
            self.error_message = Some(e);
            return;
        }
        
        std::thread::sleep(std::time::Duration::from_millis(500));
        
        let test_url = "http://localhost:9870/login/tel?number=+71231231123";
        match self.make_request(test_url) {
            Ok(response) => {
                if response.contains("The api_id/api_hash combination is invalid") {
                    self.kill_backend();
                    self.error_message = Some("Неверный API ID или API Hash".to_string());
                } else {
                    self.state = AppState::PhoneInput;
                    self.error_message = None;
                }
            }
            Err(e) => {
                self.kill_backend();
                self.error_message = Some(format!("Ошибка: {}", e));
            }
        }
    }
    
    fn send_phone(&mut self) {
        if self.phone.is_empty() {
            self.error_message = Some("Введите номер телефона".to_string());
            return;
        }
        
        let url = format!("http://localhost:9870/login/tel?number=+{}", self.phone);
        match self.make_request(&url) {
            Ok(response) => {
                if response.contains("error") {
                    self.error_message = Some("Ошибка: проверьте номер телефона".to_string());
                } else {
                    self.state = AppState::CodeInput;
                    self.error_message = None;
                }
            }
            Err(e) => {
                self.error_message = Some(format!("Ошибка: {}", e));
            }
        }
    }
    
    fn send_code(&mut self) {
        if self.code.is_empty() {
            self.error_message = Some("Введите код подтверждения".to_string());
            return;
        }
        
        let url = format!("http://localhost:9870/login/tel/code?code={}&phone=+{}", self.code, self.phone);
        match self.make_request(&url) {
            Ok(response) => {
                if response.contains("error") || response.contains("INVALID") {
                    self.error_message = Some("Неверный код подтверждения".to_string());
                } else {
                    self.state = AppState::MainChat;
                    self.error_message = None;
                    self.load_chats();
                }
            }
            Err(e) => {
                self.error_message = Some(format!("Ошибка: {}", e));
            }
        }
    }
    
    fn format_date(&self, date_str: &str) -> String {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_str) {
            let now = chrono::Local::now();
            let diff = now.signed_duration_since(dt.with_timezone(&chrono::Local));
            
            if diff.num_days() > 0 {
                return dt.format("%d.%m").to_string();
            } else if diff.num_hours() > 0 {
                return format!("{}ч", diff.num_hours());
            } else if diff.num_minutes() > 0 {
                return format!("{}м", diff.num_minutes());
            } else {
                return "только что".to_string();
            }
        }
        date_str.to_string()
    }
}

impl eframe::App for UranApp {
    fn update(&mut self, ctx: &Context, _frame: &mut Frame) {
        if self.state == AppState::MainChat {
            egui::CentralPanel::default().show(ctx, |ui| {
                ui.horizontal(|ui| {
                    // Левая панель с чатами
                    ui.vertical(|ui| {
                        ui.set_width(300.0);
                        ui.add_space(10.0);
                        ui.heading(RichText::new("URAN").size(24.0).color(Color32::from_rgb(0, 150, 255)));
                        ui.add_space(20.0);
                        
                        ScrollArea::vertical().show(ui, |ui| {
                            let chats = self.chats.clone();
                            for chat in chats {
                                let is_selected = self.selected_chat.as_ref().map(|c| c.id == chat.id).unwrap_or(false);
                                let frame = if is_selected {
                                    egui::Frame::default().fill(Color32::from_rgb(50, 50, 60)).inner_margin(8.0)
                                } else {
                                    egui::Frame::default().inner_margin(8.0)
                                };
                                
                                let response = frame.show(ui, |ui| {
                                    ui.horizontal(|ui| {
                                        let avatar = if chat.id > 0 { "👤" } else { "📢" };
                                        ui.label(RichText::new(avatar).size(24.0));
                                        
                                        ui.vertical(|ui| {
                                            ui.label(RichText::new(&chat.name).size(16.0).strong());
                                            if chat.unread > 0 {
                                                ui.label(RichText::new(format!("Непрочитанных: {}", chat.unread)).size(12.0).color(Color32::RED));
                                            }
                                        });
                                    });
                                });
                                
                                if response.response.clicked() {
                                    self.selected_chat = Some(chat);
                                    self.load_messages(self.selected_chat.as_ref().unwrap().id);
                                }
                            }
                        });
                        
                        if self.loading_chats {
                            ui.label("Загрузка чатов...");
                        }
                    });
                    
                    ui.separator();
                    
                    // Правая панель с сообщениями
                    ui.vertical(|ui| {
                        if let Some(chat) = self.selected_chat.clone() {
                            // Header с информацией о чате
                            egui::Frame::default().fill(Color32::from_rgb(40, 40, 45)).show(ui, |ui| {
                                ui.horizontal(|ui| {
                                    let avatar = if chat.id > 0 { "👤" } else { "📢" };
                                    ui.label(RichText::new(avatar).size(32.0));
                                    ui.vertical(|ui| {
                                        ui.label(RichText::new(&self.current_chat_name).size(18.0).strong());
                                        ui.label(RichText::new(&chat.chat_type).size(12.0).color(Color32::GRAY));
                                    });
                                });
                            });
                            
                            ui.add_space(10.0);
                            
                            // Список сообщений
                            ScrollArea::vertical().show(ui, |ui| {
                                let messages = self.messages.clone();
                                for msg in messages {
                                    egui::Frame::default().inner_margin(8.0).show(ui, |ui| {
                                        ui.horizontal(|ui| {
                                            ui.vertical(|ui| {
                                                ui.label(RichText::new(&msg.sender).size(14.0).strong().color(Color32::from_rgb(100, 200, 255)));
                                                ui.label(RichText::new(self.format_date(&msg.date)).size(10.0).color(Color32::GRAY));
                                            });
                                            
                                            ui.add_space(20.0);
                                            
                                            if let Some(text) = &msg.text {
                                                ui.label(RichText::new(text).size(14.0));
                                            }
                                            
                                            if msg.media.is_some() {
                                                ui.colored_label(Color32::LIGHT_BLUE, "[Медиафайл]");
                                            }
                                        });
                                    });
                                }
                            });
                            
                            if self.loading_messages {
                                ui.label("Загрузка сообщений...");
                            }
                            
                            ui.add_space(10.0);
                            
                            // Поле ввода сообщения
                            egui::Frame::default().fill(Color32::from_rgb(40, 40, 45)).show(ui, |ui| {
                                ui.horizontal(|ui| {
                                    let text_edit = TextEdit::singleline(&mut self.new_message)
                                        .hint_text("Введите сообщение...")
                                        .desired_width(f32::INFINITY);
                                    ui.add(text_edit);
                                    
                                    if ui.button("📤").clicked() {
                                        self.send_message(chat.id);
                                    }
                                });
                            });
                        } else {
                            ui.centered_and_justified(|ui| {
                                ui.label(RichText::new("Выберите чат для начала общения").size(18.0).color(Color32::GRAY));
                            });
                        }
                    });
                });
            });
        } else {
            egui::CentralPanel::default().show(ctx, |ui| {
                match self.state {
                    AppState::Splash => {
                        ui.vertical_centered(|ui| {
                            ui.add_space(50.0);
                            ui.heading(RichText::new("URAN").size(48.0).color(Color32::from_rgb(0, 150, 255)));
                            ui.add_space(30.0);
                            
                            if ui.button(RichText::new("Начать первоначальную настройку").size(20.0)).clicked() {
                                self.state = AppState::Setup;
                            }
                        });
                    }
                    
                    AppState::Setup => {
                        ui.vertical_centered(|ui| {
                            ui.add_space(20.0);
                            ui.heading(RichText::new("Необходимо заполнить параметры").size(28.0).color(Color32::from_rgb(255, 100, 100)));
                            ui.add_space(20.0);
                            
                            ui.label("Инструкция:");
                            ui.label("1. Перейдите на https://my.telegram.org/");
                            ui.label("2. Войдите в свой аккаунт Telegram");
                            ui.label("3. Создайте новое приложение во вкладке 'API development tools'");
                            ui.label("4. Скопируйте полученные значения 'app_id' и 'app_hash'");
                            ui.label("5. Вставьте их в поля ниже");
                            ui.add_space(20.0);
                            
                            ui.horizontal(|ui| {
                                ui.label("App ID: ");
                                ui.text_edit_singleline(&mut self.api_id);
                            });
                            
                            ui.add_space(10.0);
                            
                            ui.horizontal(|ui| {
                                ui.label("App Hash: ");
                                ui.text_edit_singleline(&mut self.api_hash);
                            });
                            
                            ui.add_space(20.0);
                            
                            if ui.button("Далее").clicked() && !self.api_id.is_empty() && !self.api_hash.is_empty() {
                                self.start_setup();
                            }
                            
                            if let Some(error) = &self.error_message {
                                ui.colored_label(Color32::RED, error);
                            }
                        });
                    }
                    
                    AppState::PhoneInput => {
                        ui.vertical_centered(|ui| {
                            ui.add_space(30.0);
                            ui.heading(RichText::new("Введите номер телефона").size(24.0));
                            ui.add_space(20.0);
                            
                            ui.horizontal(|ui| {
                                ui.label("+");
                                ui.text_edit_singleline(&mut self.phone);
                            });
                            
                            ui.add_space(20.0);
                            
                            if ui.button("Далее").clicked() {
                                self.send_phone();
                            }
                            
                            if let Some(error) = &self.error_message {
                                ui.colored_label(Color32::RED, error);
                            }
                        });
                    }
                    
                    AppState::CodeInput => {
                        ui.vertical_centered(|ui| {
                            ui.add_space(30.0);
                            ui.heading(RichText::new("Введите код подтверждения").size(24.0));
                            ui.add_space(20.0);
                            
                            ui.label(format!("Код отправлен на номер +{}", self.phone));
                            ui.add_space(10.0);
                            
                            ui.text_edit_singleline(&mut self.code);
                            
                            ui.add_space(20.0);
                            
                            if ui.button("Подтвердить").clicked() {
                                self.send_code();
                            }
                            
                            if let Some(error) = &self.error_message {
                                ui.colored_label(Color32::RED, error);
                            }
                        });
                    }
                    
                    _ => {}
                }
            });
        }
        
        // Окно с ошибкой
        let error_message = self.error_message.clone();
        if let Some(error) = error_message {
            Window::new("Ошибка").collapsible(false).resizable(false).show(ctx, |ui| {
                ui.label(error);
                if ui.button("Закрыть").clicked() {
                    self.error_message = None;
                }
            });
        }
    }
}

fn main() {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1200.0, 800.0])
            .with_min_inner_size([800.0, 600.0]),
        ..Default::default()
    };
    
    eframe::run_native(
        "URAN Messenger",
        options,
        Box::new(|_| Box::new(UranApp::default())),
    ).expect("Failed to start app");
}