#!/usr/bin/env python3
import subprocess
import shutil
import sys
import os
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

def run_command(cmd, cwd=None):
    print(f"\n>>> Выполнение: {cmd} (в {cwd or '.'})")
    result = subprocess.run(cmd, shell=True, cwd=cwd)
    if result.returncode != 0:
        print(f"Ошибка при выполнении: {cmd}")
        sys.exit(result.returncode)
    return result

def main():
    is_windows = sys.platform == "win32"
    
    base_dir = Path.cwd()
    setup_dir = base_dir / "setup"
    launcher_dir = base_dir / "launcher"
    client_dir = base_dir / "client"
    build_dir = base_dir / "build"
    
    build_dir.mkdir(exist_ok=True)
    
    print("=" * 50)
    print("1. Сборка setup...")
    print("=" * 50)
    run_command("cargo build --release", cwd=setup_dir)
    
    if is_windows:
        setup_source = setup_dir / "target" / "release" / "uran_installer.exe"
        setup_dest = build_dir / "uran_installer.exe"
    else:
        setup_source = setup_dir / "target" / "release" / "uran_installer"
        setup_dest = build_dir / "uran_installer"
    
    if setup_source.exists():
        shutil.copy2(setup_source, setup_dest)
        print(f"Копирование: {setup_source} -> {setup_dest}")
    else:
        print(f"Ошибка: файл {setup_source} не найден!")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("2. Сборка launcher...")
    print("=" * 50)
    run_command("cargo build --release", cwd=launcher_dir)
    
    if is_windows:
        launcher_source = launcher_dir / "target" / "release" / "uran-launcher.exe"
        launcher_dest = build_dir / "launcher.exe"
    else:
        launcher_source = launcher_dir / "target" / "release" / "uran-launcher"
        launcher_dest = build_dir / "launcher"
    
    if launcher_source.exists():
        shutil.copy2(launcher_source, launcher_dest)
        print(f"Копирование: {launcher_source} -> {launcher_dest}")
    else:
        print(f"Ошибка: файл {launcher_source} не найден!")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("3. Подготовка client...")
    print("=" * 50)
    
    run_command("npm install -g electron-builder")
    run_command("npm ci", cwd=client_dir)
    run_command("npm run build", cwd=client_dir)
    
    dist_dir = client_dir / "dist"
    uran_build_dir = build_dir / "uran"
    uran_build_dir.mkdir(exist_ok=True)
    
    subdirs = [d for d in dist_dir.iterdir() if d.is_dir()]
    if subdirs:
        source_dist = subdirs[0]
        print(f"Копирование из {source_dist} в {uran_build_dir}")
        
        for item in source_dist.iterdir():
            dest_item = uran_build_dir / item.name
            if item.is_dir():
                if dest_item.exists():
                    shutil.rmtree(dest_item)
                shutil.copytree(item, dest_item)
            else:
                shutil.copy2(item, dest_item)
        print(f"Содержимое {source_dist} скопировано в {uran_build_dir}")
    else:
        print(f"Ошибка: в {dist_dir} не найдено папок с результатами сборки!")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("4. Очистка временных файлов...")
    print("=" * 50)
    
    dirs_to_remove = [
        client_dir / "node_modules",
        client_dir / "dist",
        launcher_dir / "target",
        setup_dir / "target"
    ]
    
    for dir_path in dirs_to_remove:
        if dir_path.exists():
            shutil.rmtree(dir_path)
            print(f"Удалено: {dir_path}")
        else:
            print(f"Не найдено: {dir_path}")
    
    print("\n" + "=" * 50)
    print("СБОРКА УДАЛАСЬ!")
    print("=" * 50)
    print(f"Результаты находятся в папке: {build_dir.absolute()}")
    print(f"  - Setup: {setup_dest.name}")
    print(f"  - Launcher: {launcher_dest.name}")
    print(f"  - Client: {uran_build_dir.relative_to(build_dir)}/")

if __name__ == "__main__":
    main()
