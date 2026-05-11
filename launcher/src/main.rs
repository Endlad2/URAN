use std::process::{Command, exit};
use std::path::PathBuf;
use std::env;

#[cfg(target_os = "windows")]
const URAN_EXE: &str = "uran.exe";

#[cfg(target_os = "linux")]
const URAN_EXE: &str = "uran";

#[cfg(target_os = "windows")]
fn main() {
    let appdata = match env::var("APPDATA") {
        Ok(path) => PathBuf::from(path),
        Err(_) => {
            eprintln!("APPDATA environment variable not found");
            exit(1);
        }
    };
    
    let python_path = appdata.join(".URAN").join("python").join("pythonw.exe");
    let script_path = appdata.join(".URAN").join("api").join("tg.py");
    // Исправлено: бинарник ищется в подпапке "uran"
    let uran_path = env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("uran")
        .join(URAN_EXE);
    
    if !python_path.exists() {
        eprintln!("Python not found at {:?}", python_path);
        exit(1);
    }
    
    if !script_path.exists() {
        eprintln!("Script not found at {:?}", script_path);
        exit(1);
    }
    
    let status = Command::new(&python_path)
        .arg(&script_path)
        .status()
        .expect("Failed to execute Python script");
    
    if !status.success() {
        eprintln!("Python script exited with error: {:?}", status.code());
        exit(1);
    }
    
    if !uran_path.exists() {
        eprintln!("{} not found at {:?}", URAN_EXE, uran_path);
        exit(1);
    }
    
    let status = Command::new(&uran_path)
        .status()
        .expect("Failed to execute URAN");
    
    if !status.success() {
        eprintln!("URAN exited with error: {:?}", status.code());
        exit(1);
    }
}

#[cfg(target_os = "linux")]
fn main() {
    let python_cmd = if Command::new("python3").arg("--version").output().is_ok() {
        "python3"
    } else if Command::new("python").arg("--version").output().is_ok() {
        "python"
    } else {
        eprintln!("Neither python3 nor python is available");
        exit(1);
    };
    
    let script_path = "api/tg.py";
    // Исправлено: бинарник ищется в подпапке "uran"
    let uran_path = "./uran/uran";
    
    if !PathBuf::from(script_path).exists() {
        eprintln!("Script not found at {}", script_path);
        exit(1);
    }
    
    let status = Command::new(python_cmd)
        .arg(script_path)
        .status()
        .expect("Failed to execute Python script");
    
    if !status.success() {
        eprintln!("Python script exited with error: {:?}", status.code());
        exit(1);
    }
    
    if !PathBuf::from(uran_path).exists() {
        eprintln!("uran not found at {}", uran_path);
        exit(1);
    }
    
    let _ = Command::new("chmod")
        .args(&["+x", uran_path])
        .status();
    
    let status = Command::new(&uran_path)
        .status()
        .expect("Failed to execute URAN");
    
    if !status.success() {
        eprintln!("URAN exited with error: {:?}", status.code());
        exit(1);
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn main() {
    eprintln!("Unsupported operating system");
    exit(1);
}