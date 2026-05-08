use std::fs::{self, File};
use std::io::{Write, BufReader};
use std::path::PathBuf;
use std::process::Command;
use std::env;
use winapi::um::shellapi::ShellExecuteW;
use std::ptr::null_mut;
use std::sync::mpsc;
use std::thread;
use winapi::shared::minwindef::{TRUE, FALSE, LPARAM, WPARAM, UINT};
use winapi::shared::windef::HWND;
use winapi::um::winuser::{MB_OK, MessageBoxW};

fn main() {
    if !is_admin() {
        request_admin();
        return;
    }

    let (tx, rx) = mpsc::channel();
    
    let installer_thread = thread::spawn(move || {
        let steps = vec![
            "Создание папок...",
            "Определение архитектуры...",
            "Загрузка Python...",
            "Распаковка Python...",
            "Загрузка pip...",
            "Установка зависимостей...",
            "Загрузка API...",
            "Распаковка API...",
            "Загрузка launcher.exe...",
            "Создание ярлыков..."
        ];
        
        for (i, step) in steps.iter().enumerate() {
            tx.send((i, step.to_string())).unwrap();
            match i {
                0 => create_folders(),
                1 => detect_arch(),
                2 => download_python(),
                3 => extract_python(),
                4 => download_pip(),
                5 => install_deps(),
                6 => download_api(),
                7 => extract_api(),
                8 => download_launcher(),
                9 => create_shortcuts(),
                _ => {}
            }
            thread::sleep(std::time::Duration::from_millis(100));
        }
        tx.send((10, "Готово!".to_string())).unwrap();
    });

    show_gui(rx);
    installer_thread.join().unwrap();
}

fn is_admin() -> bool {
    use winapi::um::securitybaseapi::GetTokenInformation;
    use winapi::um::winnt::{TOKEN_QUERY, TokenElevation, HANDLE};
    use winapi::um::processthreadsapi::GetCurrentProcess;
    use winapi::um::handleapi::CloseHandle;
    
    let mut token: HANDLE = null_mut();
    unsafe {
        if winapi::um::processthreadsapi::OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let result = GetTokenInformation(token, TokenElevation, &mut elevation as *mut _ as *mut _, size, &mut size);
        CloseHandle(token);
        result == TRUE && elevation != 0
    }
}

fn request_admin() {
    let operation = "runas\0".encode_utf16().collect::<Vec<u16>>();
    let file = std::env::current_exe().unwrap();
    let file_str = file.to_str().unwrap();
    let file_wide: Vec<u16> = file_str.encode_utf16().chain(Some(0)).collect();
    
    unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            file_wide.as_ptr(),
            null_mut(),
            null_mut(),
            5,
        );
    }
    std::process::exit(0);
}

fn show_gui(rx: mpsc::Receiver<(usize, String)>) {
    use winapi::um::winuser::{
        CreateWindowExW, DispatchMessageW, GetMessageW, 
        LoadCursorW, RegisterClassW, ShowWindow, TranslateMessage, 
        MSG, WNDCLASSW, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, IDC_ARROW,
        WM_CREATE, WM_DESTROY, WS_CHILD, WS_VISIBLE, SS_CENTER,
        DestroyWindow, PostQuitMessage, SetWindowTextW, SendMessageW, DefWindowProcW
    };
    use winapi::shared::windef::POINT;
    use std::ptr::null_mut;
    
    let hinstance = unsafe { winapi::um::libloaderapi::GetModuleHandleW(null_mut()) };
    
    let class_name = "URANInstaller\0".encode_utf16().collect::<Vec<u16>>();
    
    let wc = WNDCLASSW {
        style: 0,
        lpfnWndProc: Some(window_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: 0 as _,
        hCursor: unsafe { LoadCursorW(0 as _, IDC_ARROW) },
        hbrBackground: 0 as _,
        lpszMenuName: null_mut(),
        lpszClassName: class_name.as_ptr(),
    };
    
    unsafe { RegisterClassW(&wc); }
    
    let rx = Box::new(rx);
    
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            "URAN Installer\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT, CW_USEDEFAULT, 500, 300,
            null_mut(),
            null_mut(),
            hinstance,
            Box::into_raw(rx) as _,
        )
    };
    
    unsafe { ShowWindow(hwnd, 1); }
    
    let mut msg = MSG { 
        hwnd: null_mut(), 
        message: 0, 
        wParam: 0, 
        lParam: 0, 
        time: 0, 
        pt: POINT { x: 0, y: 0 } 
    };
    
    unsafe {
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

extern "system" fn window_proc(hwnd: HWND, msg: UINT, wparam: WPARAM, lparam: LPARAM) -> isize {
    use winapi::um::winuser::{
        WM_CREATE, WM_DESTROY, CreateWindowExW, WS_CHILD, WS_VISIBLE, SS_CENTER,
        DestroyWindow, PostQuitMessage, SendMessageW, SetWindowTextW, DefWindowProcW,
        WM_TIMER, SetTimer
    };
    use std::ptr::null_mut;
    use std::sync::mpsc::Receiver;
    
    static mut LABEL_HWND: HWND = null_mut();
    static mut PROGRESS_HWND: HWND = null_mut();
    static mut RX_PTR: *mut Receiver<(usize, String)> = null_mut();
    
    if msg == WM_CREATE {
        let createstruct = unsafe { &*(lparam as *const winapi::um::winuser::CREATESTRUCTW) };
        let rx = createstruct.lpCreateParams as *mut Receiver<(usize, String)>;
        
        unsafe {
            RX_PTR = rx;
            
            LABEL_HWND = CreateWindowExW(
                0,
                "STATIC\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
                "Подготовка к установке...\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
                WS_CHILD | WS_VISIBLE | SS_CENTER,
                20, 100, 460, 30,
                hwnd,
                null_mut(),
                createstruct.hInstance,
                null_mut(),
            );
            
            PROGRESS_HWND = CreateWindowExW(
                0,
                "msctls_progress32\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
                null_mut(),
                WS_CHILD | WS_VISIBLE,
                20, 150, 460, 30,
                hwnd,
                null_mut(),
                createstruct.hInstance,
                null_mut(),
            );
        }
        
        unsafe {
            SetTimer(hwnd, 1, 100, None);
        }
        
        return 0;
    }
    
    if msg == WM_TIMER {
        unsafe {
            if !RX_PTR.is_null() {
                let rx = &*RX_PTR;
                if let Ok((step, text)) = rx.try_recv() {
                    let text_wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
                    SetWindowTextW(LABEL_HWND, text_wide.as_ptr());
                    let pos = (step * 10) as i32;
                    SendMessageW(PROGRESS_HWND, 0x0400 + 2, 0, pos as isize);
                    
                    if step == 10 {
                        MessageBoxW(hwnd, 
                            "Установка завершена!\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
                            "Успех\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
                            MB_OK);
                        DestroyWindow(hwnd);
                    }
                }
            }
        }
        return 0;
    }
    
    if msg == WM_DESTROY {
        unsafe {
            if !RX_PTR.is_null() {
                drop(Box::from_raw(RX_PTR));
            }
            PostQuitMessage(0);
        }
        return 0;
    }
    
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn create_folders() {
    let appdata = env::var("APPDATA").unwrap();
    let uran_dir = PathBuf::from(appdata).join(".URAN");
    fs::create_dir_all(&uran_dir).unwrap();
    fs::create_dir_all(uran_dir.join("python")).unwrap();
    fs::create_dir_all(uran_dir.join("api")).unwrap();
}

fn detect_arch() {
    let _arch = std::env::consts::ARCH;
}

fn download_python() {
    let arch = if cfg!(target_arch = "x86_64") { "amd64" } else { "win32" };
    let url = format!("https://www.python.org/ftp/python/3.10.0/python-3.10.0-embed-{}.zip", arch);
    let client = reqwest::blocking::Client::new();
    let response = client.get(&url).send().unwrap();
    let appdata = env::var("APPDATA").unwrap();
    let zip_path = PathBuf::from(&appdata).join(".URAN").join("python.zip");
    let mut file = File::create(&zip_path).unwrap();
    file.write_all(&response.bytes().unwrap()).unwrap();
}

fn extract_python() {
    let appdata = env::var("APPDATA").unwrap();
    let zip_path = PathBuf::from(&appdata).join(".URAN").join("python.zip");
    let extract_to = PathBuf::from(&appdata).join(".URAN").join("python");
    let file = File::open(&zip_path).unwrap();
    let mut archive = zip::ZipArchive::new(BufReader::new(file)).unwrap();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        let outpath = extract_to.join(file.name());
        if file.is_dir() {
            fs::create_dir_all(&outpath).unwrap();
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).unwrap();
                }
            }
            let mut outfile = File::create(&outpath).unwrap();
            std::io::copy(&mut file, &mut outfile).unwrap();
        }
    }
    fs::remove_file(zip_path).unwrap();
}

fn download_pip() {
    let client = reqwest::blocking::Client::new();
    let response = client.get("https://bootstrap.pypa.io/pip/pip.pyz").send().unwrap();
    let appdata = env::var("APPDATA").unwrap();
    let pip_path = PathBuf::from(&appdata).join(".URAN").join("python").join("pip.pyz");
    let mut file = File::create(pip_path).unwrap();
    file.write_all(&response.bytes().unwrap()).unwrap();
}

fn install_deps() {
    let appdata = env::var("APPDATA").unwrap();
    let python_dir = PathBuf::from(&appdata).join(".URAN").join("python");
    let python_exe = python_dir.join("pythonw.exe");
    let pip_path = python_dir.join("pip.pyz");
    let api_dir = PathBuf::from(&appdata).join(".URAN").join("api");
    
    let _output = Command::new(python_exe)
        .arg(pip_path)
        .arg("install")
        .arg("-r")
        .arg("https://raw.githubusercontent.com/Endlad2/Uran-api/refs/heads/main/requirements.txt")
        .arg("--target")
        .arg(api_dir)
        .output()
        .unwrap();
}

fn download_api() {
    let client = reqwest::blocking::Client::new();
    let response = client.get("https://github.com/Endlad2/Uran-api/archive/refs/heads/main.zip").send().unwrap();
    let appdata = env::var("APPDATA").unwrap();
    let zip_path = PathBuf::from(&appdata).join(".URAN").join("api.zip");
    let mut file = File::create(&zip_path).unwrap();
    file.write_all(&response.bytes().unwrap()).unwrap();
}

fn extract_api() {
    let appdata = env::var("APPDATA").unwrap();
    let zip_path = PathBuf::from(&appdata).join(".URAN").join("api.zip");
    let extract_to = PathBuf::from(&appdata).join(".URAN").join("api");
    let file = File::open(&zip_path).unwrap();
    let mut archive = zip::ZipArchive::new(BufReader::new(file)).unwrap();
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        let name = file.name();
        if name.starts_with("Uran-api-main/") {
            let relative = &name["Uran-api-main/".len()..];
            if !relative.is_empty() {
                let outpath = extract_to.join(relative);
                if file.is_dir() {
                    fs::create_dir_all(&outpath).unwrap();
                } else {
                    if let Some(p) = outpath.parent() {
                        if !p.exists() {
                            fs::create_dir_all(p).unwrap();
                        }
                    }
                    let mut outfile = File::create(&outpath).unwrap();
                    std::io::copy(&mut file, &mut outfile).unwrap();
                }
            }
        }
    }
    fs::remove_file(zip_path).unwrap();
}

fn download_launcher() {
    let client = reqwest::blocking::Client::new();
    let response = client.get("https://github.com/Endlad2/Uran-api/releases/download/pre/launcher.exe").send().unwrap();
    let appdata = env::var("APPDATA").unwrap();
    let launcher_path = PathBuf::from(&appdata).join(".URAN").join("launcher.exe");
    let mut file = File::create(launcher_path).unwrap();
    file.write_all(&response.bytes().unwrap()).unwrap();
}

fn create_shortcuts() {
    let appdata = env::var("APPDATA").unwrap();
    let program_data = env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    let start_menu = PathBuf::from(&program_data).join(r"Microsoft\Windows\Start Menu\Programs\URAN");
    
    fs::create_dir_all(&start_menu).unwrap();
    
    let launcher_exe = PathBuf::from(&appdata).join(".URAN").join("launcher.exe");
    let launcher_link = start_menu.join("URAN.lnk");
    
    let uninstall_bat = start_menu.join("Uninstall.bat");
    let mut bat_file = File::create(&uninstall_bat).unwrap();
    let bat_content = format!(r#"@echo off
echo Удаление URAN...
rmdir /s /q "{}"
echo Удаление завершено!
timeout /t 3
"#, PathBuf::from(&appdata).join(".URAN").display());
    bat_file.write_all(bat_content.as_bytes()).unwrap();
    
    let vbs_script = start_menu.join("create_shortcut.vbs");
    let mut vbs_file = File::create(&vbs_script).unwrap();
    let vbs_content = format!(r#"
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "{}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "{}"
oLink.Save
"#, launcher_link.display().to_string().replace("\\", "\\\\"), launcher_exe.display().to_string().replace("\\", "\\\\"));
    vbs_file.write_all(vbs_content.as_bytes()).unwrap();
    
    Command::new("cscript")
        .arg("//nologo")
        .arg(&vbs_script)
        .output()
        .unwrap();
    
    fs::remove_file(vbs_script).unwrap();
    
    let uninstall_link = start_menu.join("Uninstall.lnk");
    let vbs_script2 = start_menu.join("create_shortcut2.vbs");
    let mut vbs_file2 = File::create(&vbs_script2).unwrap();
    let vbs_content2 = format!(r#"
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "{}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "{}"
oLink.Save
"#, uninstall_link.display().to_string().replace("\\", "\\\\"), uninstall_bat.display().to_string().replace("\\", "\\\\"));
    vbs_file2.write_all(vbs_content2.as_bytes()).unwrap();
    
    Command::new("cscript")
        .arg("//nologo")
        .arg(&vbs_script2)
        .output()
        .unwrap();
    
    fs::remove_file(vbs_script2).unwrap();
}