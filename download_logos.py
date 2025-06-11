from mwrogue.esports_client import EsportsClient
import urllib.request
import os
import json
import sys

def ensure_cache_dir():
    cache_dir = os.path.join(os.path.dirname(__file__), '..', 'cache', 'team_logos')
    if not os.path.exists(cache_dir):
        os.makedirs(cache_dir)
    return cache_dir

def get_filename_url_to_open(site: EsportsClient, filename, team, width=None):
    try:
        response = site.client.api(
            action="query",
            format="json",
            titles=f"File:{filename}",
            prop="imageinfo",
            iiprop="url",
            iiurlwidth=width,
        )

        pages = response["query"]["pages"]
        page_id = next(iter(pages))
        
        if page_id == "-1":
            print(f"找不到圖片: {filename}")
            return None

        image_info = pages[page_id]["imageinfo"][0]
        url = image_info["thumburl"] if width else image_info["url"]
        return url
    except Exception as e:
        print(f"獲取圖片 URL 時發生錯誤: {e}")
        return None

def download_team_logo(team_name, cache_dir):
    site = EsportsClient("lol")
    
    # 嘗試不同的檔案名稱格式
    filename_formats = [
        f"{team_name} logo profile.png",
        f"{team_name}logo square.png",
        f"{team_name} logo.png",
        f"{team_name}.png"
    ]
    
    for filename in filename_formats:
        url = get_filename_url_to_open(site, filename, team_name)
        if url:
            try:
                local_path = os.path.join(cache_dir, f"{team_name}.png")
                urllib.request.urlretrieve(url, local_path)
                print(f"成功下載 {team_name} 的 logo 到 {local_path}")
                return True
            except Exception as e:
                print(f"下載圖片時發生錯誤: {e}")
    
    print(f"無法為 {team_name} 找到任何可用的 logo")
    return False

def main():
    # 檢查是否有命令行參數
    if len(sys.argv) > 1:
        # 如果提供了隊伍名稱，只下載該隊伍的 logo
        team_name = sys.argv[1]
        cache_dir = ensure_cache_dir()
        print(f"正在下載 {team_name} 的 logo...")
        success = download_team_logo(team_name, cache_dir)
        # 輸出結果供 JavaScript 使用
        print("SUCCESS" if success else "FAILED")
    else:
        # 如果沒有提供參數，下載所有隊伍的 logo
        try:
            with open('teams.json', 'r', encoding='utf-8') as f:
                teams = json.load(f)
        except FileNotFoundError:
            print("找不到 teams.json 檔案")
            return
        except json.JSONDecodeError:
            print("teams.json 檔案格式錯誤")
            return

        cache_dir = ensure_cache_dir()
        print(f"圖片將被下載到: {cache_dir}")

        for team in teams:
            print(f"\n正在處理隊伍: {team}")
            download_team_logo(team, cache_dir)

if __name__ == "__main__":
    main() 