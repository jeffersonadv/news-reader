# News Reader - Feed de Notícias Inteligente e sem Custos

Um leitor de notícias web moderno, focado em legibilidade e produtividade. Ele raspa as manchetes com foto do portal **UOL**, permitindo marcar matérias como lidas de forma automática ao rolar a página, compartilhar links instantaneamente no WhatsApp/Telegram e silenciar termos e assuntos indesejados através de filtros inteligentes de palavras-chave.

Hospedado de forma 100% gratuita através de **GitHub Pages** e atualizado automaticamente de hora em hora via **GitHub Actions**.

---

## ⚡ Recursos Principais

* **Marcação Automática por Rolagem**: Ao rolar e passar por um card de notícia, ela é automaticamente salva como lida e não reaparecerá no feed principal.
* **Filtros de Exclusão Inteligentes (Mute List)**: Baniu a palavra "pet"? Notícias com essa palavra desaparecem instantaneamente. Você pode silenciar clicando diretamente no botão de bloquear assunto em qualquer notícia.
* **Compartilhamento Rápido**: Encaminhe a notícia formatada para WhatsApp ou Telegram em um clique.
* **100% Responsivo & Dark Mode**: Visual escuro premium em formato glassmorphism projetado para uso mobile.
* **Custo Zero**: Sem taxa de hospedagem, sem necessidade de banco de dados nem servidores dedicados.

---

## 🚀 Como subir para o seu GitHub e Ativar a Hospedagem Gratuita

Siga os passos rápidos abaixo para hospedar o leitor no seu próprio perfil do GitHub de graça:

### 1. Criar repositório no GitHub
1. Vá até o seu [GitHub](https://github.com) e crie um novo repositório vazio.
2. Dê o nome de `news-reader`.
3. Escolha a opção **Public** (Público) para poder usar o GitHub Pages gratuito.
4. Não marque nenhuma opção de inicializar com README ou .gitignore. Clique em **Create repository**.

### 2. Inicializar o Git localmente e enviar os arquivos
Abra o prompt de comando ou terminal na pasta `c:/Users/nasci/OneDrive/Documentos/news-reader` e digite os seguintes comandos (substitua `SEU-USUARIO` pelo seu nome de perfil do GitHub):

```bash
git init
git add .
git commit -m "feat: setup inicial do news-reader"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/news-reader.git
git push -u origin main
```

### 3. Habilitar o GitHub Pages
1. No seu repositório no GitHub, clique na aba **Settings** (Configurações).
2. Na barra lateral esquerda, clique em **Pages**.
3. Na seção **Build and deployment**, sob **Source**, mantenha `Deploy from a branch`.
4. Em **Branch**, selecione `main` e a pasta `/ (root)`. Clique em **Save**.
5. Em poucos minutos, o GitHub exibirá o link público do seu aplicativo, por exemplo: `https://SEU-USUARIO.github.io/news-reader/`.

---

## 🛠️ Como rodar e testar localmente

Você pode executar a raspagem e visualizar a página no seu computador local para testar:

1. **Rodar a Raspagem**:
   ```bash
   python execution/scrape_uol.py
   ```
   Isso gerará o arquivo `noticias.json` contendo as últimas notícias.

2. **Visualizar a Interface**:
   Basta abrir o arquivo `index.html` em qualquer navegador ou usar um servidor local básico:
   ```bash
   python -m http.server 8000
   ```
   E acessar `http://localhost:8000`.
