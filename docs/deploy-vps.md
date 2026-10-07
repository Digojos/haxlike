# Deploy em VPS com nginx

Este guia coloca o HaxLike numa VPS que **já tem nginx** servindo outras aplicações. O jogo roda num container Docker que só escuta em `127.0.0.1`, e o nginx recebe o domínio e o HTTPS e repassa as conexões (incluindo o WebSocket) para ele.

```
Jogadores ──HTTPS/WSS──▶ nginx (:443) ──HTTP/WS──▶ 127.0.0.1:8787 ──▶ container haxlike
                          ├─ app1.seudominio.com ──▶ outras aplicações
                          └─ app2.seudominio.com ──▶ ...
```

## Antes de começar

- **Use um subdomínio próprio** (ex.: `jogo.seudominio.com`). Servir num caminho (`seudominio.com/jogo`) **não funciona** hoje: a página carrega os arquivos de `/assets/...` e conecta em `/ws`, ambos na raiz do domínio.
- **Escolha uma porta livre** na VPS para o container. O padrão é 8787. Confira o que já está em uso com:
  ```bash
  sudo ss -ltnp
  ```
- **Docker e Compose na VPS.** Se ainda não tiver:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## 1. DNS

No painel do seu domínio, crie um registro **A** `jogo` apontando para o IP da VPS (e **AAAA**, se usar IPv6).

Se o domínio estiver no Cloudflare com o proxy ligado (nuvem laranja), tudo bem: o Cloudflare repassa WebSocket. Para emitir o certificado com o certbot no passo 5, pode ser mais simples desligar o proxy temporariamente.

## 2. Levar o projeto para a VPS

Com git:

```bash
git clone <url-do-repositorio> ~/haxlike
```

Ou copiando do seu computador, sem `node_modules` e `dist`:

```bash
rsync -av --exclude node_modules --exclude dist ./ usuario@IP-DA-VPS:~/haxlike/
```

No Windows sem rsync, compacte a pasta (sem `node_modules` e `dist`) e envie com `scp`.

## 3. Configurar e subir o container

Na VPS, dentro da pasta do projeto, crie um arquivo `.env`. O Docker Compose lê esse arquivo automaticamente:

```bash
cd ~/haxlike
cat > .env <<'EOF'
BIND_ADDRESS=127.0.0.1
HOST_PORT=8787
EOF
```

`BIND_ADDRESS=127.0.0.1` é importante. O Docker publica portas **passando por cima do firewall** (ufw/iptables). Sem essa linha, a porta 8787 ficaria aberta para a internet, ao lado do nginx.

Suba o container e confira:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/health
```

- `docker compose ps` deve mostrar `healthy`.
- O `curl` deve responder `{"status":"ok","rooms":0}`.

## 4. Configurar o nginx

Copie o modelo [`deploy/nginx.conf`](../deploy/nginx.conf). Em Debian/Ubuntu:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/haxlike
sudo nano /etc/nginx/sites-available/haxlike
```

Em outras distribuições, use `/etc/nginx/conf.d/haxlike.conf` e pule o `ln` do próximo passo.

Ajuste no arquivo:

- `server_name` → seu subdomínio;
- `server 127.0.0.1:8787;` → a porta que você escolheu no `HOST_PORT`.

O que o modelo já traz:

- **Cabeçalhos `Upgrade` / `Connection`:** sem eles o WebSocket falha e o jogo mostra "Não foi possível conectar".
- **`proxy_read_timeout 1h`:** evita que o nginx derrube conexões longas.

Ative e recarregue (o `nginx -t` valida a configuração antes de aplicar):

```bash
sudo ln -s /etc/nginx/sites-available/haxlike /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. HTTPS

Se você já usa certbot nas outras aplicações:

```bash
sudo certbot --nginx -d jogo.seudominio.com
```

Ele adiciona o bloco `listen 443 ssl` e o redirecionamento de HTTP para HTTPS. O jogo detecta HTTPS sozinho e passa a usar `wss://` para o WebSocket.

## 6. Testar

1. Abra `https://jogo.seudominio.com`.
2. **Jogar online** → crie uma sala.
3. Abra de outro dispositivo (ou peça para um amigo) e entre na sala.

## Atualizando

Depois de mudar o código, leve os arquivos para a VPS (com `git pull` ou `rsync`) e rode:

```bash
docker compose up -d --build
```

Isso reinicia o container, então salas e partidas em andamento são encerradas. Prefira atualizar quando ninguém estiver jogando.

## Se o nginx também roda em Docker

Nesse caso, `127.0.0.1` dentro do container do nginx não é a VPS. Coloque os dois containers na mesma rede Docker:

- no `proxy_pass` / `upstream`, use `server haxlike:8787;`;
- no `compose.yaml` do HaxLike, remova `ports:` e adicione a rede externa do nginx:

```yaml
services:
  haxlike:
    # ...
    networks: [proxy]

networks:
  proxy:
    external: true   # nome da rede que o seu nginx já usa
```

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| **502 Bad Gateway** | Container parado ou porta errada no `upstream`. Veja `docker compose ps` e `curl 127.0.0.1:PORTA/health`. |
| Página abre, mas "Não foi possível conectar ao servidor" | Faltam os cabeçalhos `Upgrade`/`Connection` no nginx. Use o modelo. |
| Conexão cai depois de ~60 s | `proxy_read_timeout` não configurado. |
| Porta 8787 acessível de fora | `.env` sem `BIND_ADDRESS=127.0.0.1`. Rode `docker compose up -d` de novo depois de corrigir. |
| `nginx -t` reclama de `map` duplicado | Já existe um `map $http_upgrade` com o mesmo nome de variável. Remova o do arquivo do HaxLike e use o existente. |
| Ping alto para todos | É a distância até a VPS. Para jogadores no Brasil, uma VPS em São Paulo fica na faixa de 10–40 ms. |
