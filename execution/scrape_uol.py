import urllib.request
import ssl
import re
import json
import os

def scrape_uol():
    print("Iniciando raspagem completa do UOL...")
    
    # Configuração para ignorar erros de SSL
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    }

    url_home = "https://www.uol.com.br/"
    try:
        req = urllib.request.Request(url_home, headers=headers)
        with urllib.request.urlopen(req, context=ctx) as response:
            html = response.read().decode('utf-8', errors='ignore')
            
        # Localiza a variável __INITIAL_STATE__
        match = re.search(r'__INITIAL_STATE__\s*=\s*(\{)', html)
        if not match:
            print("Erro: Não foi possível localizar __INITIAL_STATE__ na página.")
            return False
            
        start_index = match.start(1)
        decoder = json.JSONDecoder()
        state, _ = decoder.raw_decode(html, start_index)
        
        extracted_items = []
        
        # Scanner recursivo para varrer todo o JSON de estado do UOL por links de notícias válidas
        def scan_recursive(obj, is_main=False, is_carousel=False, is_video=False, parent_key=""):
            if isinstance(obj, dict):
                component = obj.get('component', '')
                category = obj.get('category', '')
                current_is_main = is_main
                if component == 'CardHeadlineMain' or category == 'card-headline-main':
                    current_is_main = True
                
                current_is_video = is_video
                if parent_key == 'headlineVideo' or obj.get('type') == 'live' or obj.get('labelLive') == 'AO VIVO':
                    current_is_video = True
                
                title = obj.get('title') or obj.get('headline')
                link = obj.get('link') or obj.get('url') or obj.get('href') or obj.get('linkMais')
                
                if title and link and isinstance(title, str) and isinstance(link, str):
                    link_lower = link.lower()
                    
                    is_article = (
                        '.htm' in link_lower or 
                        '.ghtm' in link_lower or 
                        '.shtml' in link_lower or
                        '/noticias/' in link_lower or 
                        '/colunas/' in link_lower or 
                        '/ao-vivo/' in link_lower or 
                        'redirect-flash' in link_lower or
                        '/reportagem/' in link_lower or
                        'videos.uol.com.br' in link_lower
                    )
                    
                    if is_article and len(title) > 20 and not any(x in link_lower for x in ['/social/', '/playlist/', '/videos/index', '/email/']):
                        photo_url = ""
                        media_id = obj.get('mediaId')
                        if media_id and current_is_video:
                            photo_url = f"https://thumb.mais.uol.com.br/{media_id}-large.jpg"
                        
                        if not photo_url:
                            photo = obj.get('photo') or obj.get('image') or obj.get('thumbnail')
                            if isinstance(photo, str):
                                photo_url = photo
                            elif isinstance(photo, dict):
                                images = photo.get('images', [])
                                if images and isinstance(images, list) and isinstance(images[0], dict):
                                    photo_url = images[0].get('src') or images[0].get('url') or ""
                                if not photo_url:
                                    photo_url = photo.get('url') or photo.get('src') or ""
                                    
                        if not photo_url:
                            for k, v in obj.items():
                                if any(x in k.lower() for x in ['img', 'image', 'photo', 'thumb', 'pic']):
                                    if isinstance(v, str) and (v.startswith('http') or v.startswith('//') or v.startswith('/')):
                                        photo_url = v
                                        break
                                        
                        if photo_url and isinstance(photo_url, str):
                            if photo_url.startswith('//'):
                                photo_url = 'https:' + photo_url
                            elif photo_url.startswith('/'):
                                photo_url = 'https://www.uol.com.br' + photo_url
                        else:
                            photo_url = ""
                            
                        if link.startswith('//'):
                            link = 'https:' + link
                        elif link.startswith('/'):
                            link = 'https://www.uol.com.br' + link
                            
                        source_label = 'Folha' if 'folha.uol.com.br' in link_lower else 'UOL'
                        if current_is_video:
                            source_label = 'Canal UOL'
                            
                        extracted_items.append({
                            'title': title.strip(),
                            'link': link.strip(),
                            'photo': photo_url,
                            'source': source_label,
                            'is_main': current_is_main,
                            'is_carousel': is_carousel,
                            'is_video': current_is_video
                        })
                
                for k, val in obj.items():
                    child_is_main = current_is_main
                    child_is_carousel = is_carousel
                    child_is_video = current_is_video
                    
                    if k in ['mainHighlights', 'headlineHybrid']:
                        child_is_main = True
                    if k in ['headlineCollection', 'asideRows']:
                        child_is_carousel = True
                    if k == 'headlineVideo':
                        child_is_video = True
                        
                    scan_recursive(val, is_main=child_is_main, is_carousel=child_is_carousel, is_video=child_is_video, parent_key=k)
                    
            elif isinstance(obj, list):
                for val in obj:
                    scan_recursive(val, is_main, is_carousel, is_video, parent_key)
                    
        scan_recursive(state)
        
        # Filtra e remove duplicadas priorizando as que contêm fotos e mesclando metadados
        unique_news_dict = {}
        for news in extracted_items:
            url = news['link']
            if url not in unique_news_dict:
                unique_news_dict[url] = news
            else:
                if news['photo'] and not unique_news_dict[url]['photo']:
                    unique_news_dict[url]['photo'] = news['photo']
                if news.get('is_main'):
                    unique_news_dict[url]['is_main'] = True
                if news.get('is_carousel'):
                    unique_news_dict[url]['is_carousel'] = True
                if news.get('is_video'):
                    unique_news_dict[url]['is_video'] = True
                if news['source'] == 'Canal UOL':
                    unique_news_dict[url]['source'] = 'Canal UOL'
                
        unique_news = list(unique_news_dict.values())
                
        print(f"Total de notícias extraídas de forma recursiva: {len(unique_news)}")
        
        # Caminho do arquivo de saída
        output_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        output_file = os.path.join(output_dir, "noticias.json")
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(unique_news, f, ensure_ascii=False, indent=2)
            
        print(f"Arquivo salvo com sucesso em: {output_file}")
        return True
        
    except Exception as e:
        print(f"Erro inesperado durante a raspagem: {e}")
        return False

if __name__ == "__main__":
    scrape_uol()
