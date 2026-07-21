import urllib.request
import ssl
import re
import json
import os

def scrape_uol():
    print("Iniciando raspagem do UOL...")
    
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
            
        # Localiza e decodifica a variável __INITIAL_STATE__
        match = re.search(r'__INITIAL_STATE__\s*=\s*(\{)', html)
        if not match:
            print("Erro: Não foi possível localizar __INITIAL_STATE__ na página.")
            return False
            
        start_index = match.start(1)
        decoder = json.JSONDecoder()
        state, _ = decoder.raw_decode(html, start_index)
        
        items = state.get("items", {})
        news_items = []
        
        # Extrai notícias estruturadas com títulos, links e fotos de componentes conhecidos
        for k, v in items.items():
            if isinstance(v, dict) and 'items' in v:
                v_items = v['items']
                if isinstance(v_items, list):
                    for item in v_items:
                        if isinstance(item, dict) and 'title' in item and 'link' in item:
                            title = item.get('title')
                            link = item.get('link')
                            
                            # Extração da foto
                            photo = item.get('photo')
                            photo_url = ""
                            if isinstance(photo, str):
                                photo_url = photo
                            elif isinstance(photo, dict):
                                images_list = photo.get('images')
                                if isinstance(images_list, list) and len(images_list) > 0:
                                    first_img = images_list[0]
                                    if isinstance(first_img, dict):
                                        photo_url = first_img.get('src') or first_img.get('url') or ""
                                if not photo_url:
                                    # Fallback em outras propriedades da foto
                                    photo_url = photo.get('url') or photo.get('src') or ""
                                    
                            # Normalização da URL da foto
                            if photo_url and isinstance(photo_url, str):
                                if photo_url.startswith('//'):
                                    photo_url = 'https:' + photo_url
                            else:
                                photo_url = ""
                                
                            # Normalização da URL do link
                            if link and isinstance(link, str):
                                if link.startswith('//'):
                                    link = 'https:' + link
                                elif link.startswith('/'):
                                    link = 'https://www.uol.com.br' + link
                            else:
                                link = ""
                                
                            if title and link and len(title) > 20:
                                news_items.append({
                                    'title': title.strip(),
                                    'link': link.strip(),
                                    'photo': photo_url,
                                    'source': 'UOL'
                                })
                                
        # Filtra e remove duplicadas baseando-se no link
        unique_news = []
        seen_urls = set()
        for news in news_items:
            url = news['link']
            if url not in seen_urls and not any(x in url.lower() for x in ['/social/', '/playlist/', '/videos/']):
                seen_urls.add(url)
                unique_news.append(news)
                
        print(f"Total de notícias extraídas com sucesso: {len(unique_news)}")
        
        # Cria a pasta raiz se não existir
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
