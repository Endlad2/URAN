use std::process::{Command, exit};
use std::path::PathBuf;
use std::env;
use std::fs;
use std::io;

#[cfg(target_os = "windows")]
const URAN_EXE: &str = "uran.exe";

#[cfg(target_os = "linux")]
const URAN_EXE: &str = "uran";

#[cfg(target_os = "macos")]
const URAN_EXE: &str = "uran";

// Вспомогательная функция для распаковки zip
fn extract_zip(zip_path: &PathBuf, dest_path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let outpath = dest_path.join(file.name());
        
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut outfile = fs::File::create(&outpath)?;
            io::copy(&mut file, &mut outfile)?;
        }
        
        // Устанавливаем права на выполнение для Unix систем
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                fs::set_permissions(&outpath, fs::Permissions::from_mode(mode))?;
            }
        }
    }
    
    Ok(())
}

// Упрощенная функция для создания ярлыка в меню пуск (Windows) через PowerShell
#[cfg(target_os = "windows")]
fn create_start_menu_shortcut(target_path: &PathBuf, shortcut_name: &str) {
    let programs_menu = match env::var("APPDATA") {
        Ok(path) => PathBuf::from(path).join(r"Microsoft\Windows\Start Menu\Programs"),
        Err(_) => return,
    };
    
    if !programs_menu.exists() {
        return;
    }
    
    let shortcut_path = programs_menu.join(format!("{}.lnk", shortcut_name));
    let target_str = target_path.to_str().unwrap_or("");
    
    // Исправление: создаем binding для PathBuf
    let default_path = PathBuf::from(".");
    let working_dir_path = target_path.parent().unwrap_or(&default_path);
    let working_dir = working_dir_path.to_str().unwrap_or(".");
    
    // Используем PowerShell для создания ярлыка (более надежный способ)
    let ps_script = format!(
        "$WshShell = New-Object -comObject WScript.Shell\n\
         $Shortcut = $WshShell.CreateShortcut(\"{}\")\n\
         $Shortcut.TargetPath = \"{}\"\n\
         $Shortcut.WorkingDirectory = \"{}\"\n\
         $Shortcut.Save()",
        shortcut_path.to_str().unwrap_or(""),
        target_str,
        working_dir
    );
    
    let ps_script_path = programs_menu.join("temp_create_shortcut.ps1");
    if fs::write(&ps_script_path, ps_script).is_ok() {
        let _ = Command::new("powershell")
            .args(&["-ExecutionPolicy", "Bypass", "-File", ps_script_path.to_str().unwrap_or("")])
            .status();
        let _ = fs::remove_file(ps_script_path);
    }
}

// Функция для создания ярлыка в меню приложений (Linux)
#[cfg(target_os = "linux")]
fn create_application_shortcut(target_path: &PathBuf, shortcut_name: &str) {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let desktop_dir = PathBuf::from(&home).join(".local/share/applications");
    
    if fs::create_dir_all(&desktop_dir).is_ok() {
        let desktop_file = desktop_dir.join(format!("{}.desktop", shortcut_name.to_lowercase()));
        let content = format!(
            "[Desktop Entry]\n\
            Version=1.0\n\
            Type=Application\n\
            Name={}\n\
            Exec={}\n\
            Path={}\n\
            Terminal=false\n\
            Categories=Utility;\n",
            shortcut_name,
            target_path.display(),
            target_path.parent().unwrap_or(&PathBuf::from(".")).display()
        );
        
        let _ = fs::write(desktop_file, content);
    }
}

// Функция для создания ярлыка в папке Applications (macOS)
#[cfg(target_os = "macos")]
fn create_application_shortcut(target_path: &PathBuf, shortcut_name: &str) {
    use std::os::unix::fs::PermissionsExt;
    
    let applications_dir = PathBuf::from("/Applications");
    let app_bundle = applications_dir.join(format!("{}.app", shortcut_name));
    
    if fs::create_dir_all(&app_bundle.join("Contents/MacOS")).is_ok() {
        let launcher_script = app_bundle.join("Contents/MacOS/launcher");
        let script_content = format!(
            "#!/bin/bash\n\
            cd \"{}\"\n\
            open \"{}\"\n",
            target_path.parent().unwrap_or(&PathBuf::from(".")).display(),
            target_path.display()
        );
        
        let _ = fs::write(&launcher_script, script_content);
        
        // Делаем скрипт исполняемым
        if let Ok(perms) = fs::metadata(&launcher_script) {
            let mut new_perms = perms.permissions();
            new_perms.set_mode(0o755);
            let _ = fs::set_permissions(&launcher_script, new_perms);
        }
        
        // Создаем Info.plist
        let plist_path = app_bundle.join("Contents/Info.plist");
        let plist_content = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
            <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
            <plist version=\"1.0\">\n\
            <dict>\n\
                <key>CFBundleExecutable</key>\n\
                <string>launcher</string>\n\
                <key>CFBundleIdentifier</key>\n\
                <string>com.uran.{}</string>\n\
                <key>CFBundleName</key>\n\
                <string>{}</string>\n\
            </dict>\n\
            </plist>",
            shortcut_name.to_lowercase(),
            shortcut_name
        );
        let _ = fs::write(plist_path, plist_content);
    }
}

#[cfg(target_os = "windows")]
fn main() {
    let appdata = match env::var("APPDATA") {
        Ok(path) => PathBuf::from(path),
        Err(_) => {
            eprintln!("APPDATA environment variable not found");
            exit(1);
        }
    };
    
    let uran_dir = appdata.join(".URAN");
    let python_path = uran_dir.join("python").join("pythonw.exe");
    let script_path = uran_dir.join("api").join("tg.py");
    let launcher_path = uran_dir.join("launcher.exe");
    let uran_subdir = uran_dir.join("uran");
    let _uran_path = uran_subdir.join(URAN_EXE);
    
    // Создаем папки если их нет
    fs::create_dir_all(&uran_subdir).unwrap_or_else(|e| {
        eprintln!("Failed to create URAN directory: {}", e);
        exit(1);
    });
    
    // Ищем zip архив с приложением
    let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    
    // Находим zip файл
    let zip_file = fs::read_dir(&current_dir)
        .ok()
        .and_then(|entries| {
            entries.filter_map(Result::ok)
                .find(|entry| {
                    // Исправление: создаем binding для файла
                    let file_name = entry.file_name();
                    let name = file_name.to_string_lossy();
                    name.starts_with("uran-app-") && name.ends_with(".zip")
                })
                .map(|entry| entry.path())
        });
    
    if let Some(zip_path) = zip_file {
        println!("Extracting {} to {:?}", zip_path.display(), uran_dir);
        if let Err(e) = extract_zip(&zip_path, &uran_dir) {
            eprintln!("Failed to extract zip: {}", e);
            exit(1);
        }
    }
    
    // Запускаем Python скрипт только если он существует (для Windows)
    if python_path.exists() && script_path.exists() {
        let status = Command::new(&python_path)
            .arg(&script_path)
            .status()
            .expect("Failed to execute Python script");
        
        if !status.success() {
            eprintln!("Python script exited with error: {:?}", status.code());
            exit(1);
        }
    }
    
    // Запускаем launcher
    if !launcher_path.exists() {
        eprintln!("launcher.exe not found at {:?}", launcher_path);
        eprintln!("Trying to find launcher in current directory...");
        
        // Пробуем найти launcher в текущей директории
        let current_launcher = current_dir.join("launcher.exe");
        if current_launcher.exists() {
            println!("Found launcher at {:?}", current_launcher);
            let status = Command::new(&current_launcher)
                .status()
                .expect("Failed to execute launcher");
            
            if !status.success() {
                eprintln!("Launcher exited with error: {:?}", status.code());
                exit(1);
            }
        } else {
            eprintln!("No launcher found!");
            exit(1);
        }
    } else {
        let status = Command::new(&launcher_path)
            .status()
            .expect("Failed to execute launcher");
        
        if !status.success() {
            eprintln!("Launcher exited with error: {:?}", status.code());
            exit(1);
        }
    }
    
    // Создаем ярлык в меню пуск
    create_start_menu_shortcut(&launcher_path, "URAN");
    println!("Shortcut created in Start Menu");
}

#[cfg(target_os = "linux")]
fn main() {
    // Используем системный Python
    let python_cmd = if Command::new("python3").arg("--version").output().is_ok() {
        "python3"
    } else if Command::new("python").arg("--version").output().is_ok() {
        "python"
    } else {
        eprintln!("Neither python3 nor python is available");
        exit(1);
    };
    
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let uran_dir = PathBuf::from(&home).join(".URAN");
    let script_path = uran_dir.join("api/tg.py");
    let launcher_path = uran_dir.join("launcher");
    let uran_subdir = uran_dir.join("uran");
    let _uran_path = uran_subdir.join(URAN_EXE);
    
    // Создаем папки если их нет
    fs::create_dir_all(&uran_subdir).unwrap_or_else(|e| {
        eprintln!("Failed to create URAN directory: {}", e);
        exit(1);
    });
    
    // Ищем zip архив
    let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let zip_file = fs::read_dir(&current_dir)
        .ok()
        .and_then(|entries| {
            entries.filter_map(Result::ok)
                .find(|entry| {
                    let file_name = entry.file_name();
                    let name = file_name.to_string_lossy();
                    name.starts_with("uran-app-") && name.ends_with(".zip")
                })
                .map(|entry| entry.path())
        });
    
    if let Some(zip_path) = zip_file {
        println!("Extracting {} to {:?}", zip_path.display(), uran_dir);
        if let Err(e) = extract_zip(&zip_path, &uran_dir) {
            eprintln!("Failed to extract zip: {}", e);
            exit(1);
        }
    }
    
    // Запускаем Python скрипт если он существует
    if script_path.exists() {
        let status = Command::new(python_cmd)
            .arg(&script_path)
            .status()
            .expect("Failed to execute Python script");
        
        if !status.success() {
            eprintln!("Python script exited with error: {:?}", status.code());
        }
    }
    
    // Делаем launcher исполняемым
    if launcher_path.exists() {
        let _ = Command::new("chmod").args(&["+x", &launcher_path.to_string_lossy()]).status();
    }
    
    // Запускаем launcher
    if !launcher_path.exists() {
        eprintln!("launcher not found at {:?}", launcher_path);
        let current_launcher = current_dir.join("launcher");
        if current_launcher.exists() {
            println!("Found launcher at {:?}", current_launcher);
            let _ = Command::new("chmod").args(&["+x", &current_launcher.to_string_lossy()]).status();
            let status = Command::new(&current_launcher)
                .status()
                .expect("Failed to execute launcher");
            
            if !status.success() {
                eprintln!("Launcher exited with error: {:?}", status.code());
                exit(1);
            }
        } else {
            eprintln!("No launcher found!");
            exit(1);
        }
    } else {
        let status = Command::new(&launcher_path)
            .status()
            .expect("Failed to execute launcher");
        
        if !status.success() {
            eprintln!("Launcher exited with error: {:?}", status.code());
            exit(1);
        }
    }
    
    // Создаем ярлык в меню приложений
    create_application_shortcut(&launcher_path, "URAN");
    println!("Application shortcut created");
}

#[cfg(target_os = "macos")]
fn main() {
    // Используем системный Python на macOS
    let python_cmd = if Command::new("python3").arg("--version").output().is_ok() {
        "python3"
    } else {
        eprintln!("python3 is required on macOS");
        exit(1);
    };
    
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let uran_dir = PathBuf::from(&home).join(".URAN");
    let script_path = uran_dir.join("api/tg.py");
    let launcher_path = uran_dir.join("launcher");
    let uran_subdir = uran_dir.join("uran");
    let _uran_path = uran_subdir.join(URAN_EXE);
    
    // Создаем папки если их нет
    fs::create_dir_all(&uran_subdir).unwrap_or_else(|e| {
        eprintln!("Failed to create URAN directory: {}", e);
        exit(1);
    });
    
    // Ищем zip архив
    let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let zip_file = fs::read_dir(&current_dir)
        .ok()
        .and_then(|entries| {
            entries.filter_map(Result::ok)
                .find(|entry| {
                    let file_name = entry.file_name();
                    let name = file_name.to_string_lossy();
                    name.starts_with("uran-app-") && name.ends_with(".zip")
                })
                .map(|entry| entry.path())
        });
    
    if let Some(zip_path) = zip_file {
        println!("Extracting {} to {:?}", zip_path.display(), uran_dir);
        if let Err(e) = extract_zip(&zip_path, &uran_dir) {
            eprintln!("Failed to extract zip: {}", e);
            exit(1);
        }
    }
    
    // Запускаем Python скрипт если он существует
    if script_path.exists() {
        let status = Command::new(python_cmd)
            .arg(&script_path)
            .status()
            .expect("Failed to execute Python script");
        
        if !status.success() {
            eprintln!("Python script exited with error: {:?}", status.code());
        }
    }
    
    // Делаем launcher исполняемым
    if launcher_path.exists() {
        let _ = Command::new("chmod").args(&["+x", &launcher_path.to_string_lossy()]).status();
    }
    
    // Запускаем launcher
    if !launcher_path.exists() {
        eprintln!("launcher not found at {:?}", launcher_path);
        let current_launcher = current_dir.join("launcher");
        if current_launcher.exists() {
            println!("Found launcher at {:?}", current_launcher);
            let _ = Command::new("chmod").args(&["+x", &current_launcher.to_string_lossy()]).status();
            let status = Command::new(&current_launcher)
                .status()
                .expect("Failed to execute launcher");
            
            if !status.success() {
                eprintln!("Launcher exited with error: {:?}", status.code());
                exit(1);
            }
        } else {
            eprintln!("No launcher found!");
            exit(1);
        }
    } else {
        let status = Command::new(&launcher_path)
            .status()
            .expect("Failed to execute launcher");
        
        if !status.success() {
            eprintln!("Launcher exited with error: {:?}", status.code());
            exit(1);
        }
    }
    
    // Создаем ярлык в папке Applications
    create_application_shortcut(&launcher_path, "URAN");
    println!("Application shortcut created in /Applications");
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn main() {
    eprintln!("Unsupported operating system");
    exit(1);
}