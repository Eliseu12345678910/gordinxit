# Checklist de producao

## Firebase Auth

- Ative `Anonymous` para clientes.
- Ative `Email/Password` para o admin.
- Crie um documento em `admins/{uidDoAdmin}`:

```json
{
  "isAdmin": true
}
```

## Variaveis de ambiente

Variaveis publicas do app:

```txt
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Variaveis privadas do servidor:

```txt
ADMIN_EMAIL=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
PERFECT_PAY_PUBLIC_TOKEN=
PERFECT_PAY_PLUGIN_LINK=
KIWIFY_WEBHOOK_TOKEN=
KIWIFY_WEEKLY_LINK=
KIWIFY_MONTHLY_LINK=
KIWIFY_LIFETIME_LINK=
KIWIFY_PLUGIN_LINK=
```

Nunca coloque `FIREBASE_PRIVATE_KEY` com `NEXT_PUBLIC_`.
Nunca coloque e-mail de admin como `NEXT_PUBLIC_`.

## Postbacks de pagamento

Configure estes endpoints nos painéis de pagamento em produção:

```txt
Perfect Pay:
https://gordinxit.site/api/webhooks/perfectpay?token=SEU_TOKEN_DA_PERFECT_PAY

Kiwify:
https://gordinxit.site/api/webhooks/kiwify?token=SEU_TOKEN_DA_KIWIFY
```

Se o painel oferecer campo separado de token/secret, use a URL sem query string e coloque o token no campo do painel:

```txt
https://gordinxit.site/api/webhooks/perfectpay
https://gordinxit.site/api/webhooks/kiwify
```

## Firestore

Publique as regras do arquivo `FIRESTORE_RULES.js`.

Essas regras fazem:

- Cliente nao cria chat diretamente.
- Chat com usuario/senha e criado pela API `/api/chat/access`.
- Cliente so le mensagens do proprio chat.
- Cliente so envia mensagem com `sender: "client"`.
- Admin le todos os chats e pode responder.
- Documento do chat so e lido pelo admin, porque contem hash/salt de senha.

## Senhas de acesso ao chat

- A senha nao fica no navegador depois de enviada.
- A senha nao e salva em texto puro.
- A API usa `scrypt` com salt no servidor.
- Recuperacao em outro navegador funciona com usuario + senha.

## Arquivos sensiveis

- `firebase-key.json` esta no `.gitignore`.
- Em hospedagem real, prefira variaveis de ambiente no painel da plataforma.
- Nao suba service account para repositorio publico.
