# 尚音堂直播数据分析 Web

参照 `D:\Ondoing\ondoing-web` 的方式搭建：

- React + Vite 前端
- Supabase Auth 登录
- Supabase 数据库存储直播、画像、AI 复盘
- Supabase Edge Function 调用 DeepSeek
- 可部署到 GitHub Pages

## 账户名登录

页面只显示账户名和密码。底层 Supabase Auth 仍需要邮箱格式标识，因此默认映射为：

- `admin` -> `admin@shangyintang.local`
- `guest` -> `guest@shangyintang.local`

用户不会看到邮箱，也不需要注册入口。

## 本地开发

```bash
npm install
copy .env.example .env.local
npm run dev
```

`.env.local` 填入你的第二个 Supabase 项目：

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Supabase 设置

1. 新建 Supabase 项目。
2. 在 SQL Editor 运行 `supabase/schema.sql`。
3. 在 Authentication 创建两个用户：
   - Email: `admin@shangyintang.local`
   - Email: `guest@shangyintang.local`
4. 查出两个用户的 UUID。
5. 回到 SQL Editor 运行：

```sql
insert into public.user_roles (user_id, role)
values ('ADMIN_USER_UUID', 'admin')
on conflict (user_id) do update set role = excluded.role;

insert into public.user_roles (user_id, role)
values ('GUEST_USER_UUID', 'guest')
on conflict (user_id) do update set role = excluded.role;
```

## DeepSeek Edge Function

```bash
supabase functions deploy live-ai-gateway
supabase secrets set DEEPSEEK_API_KEY="你的DeepSeek Key"
supabase secrets set DEEPSEEK_MODEL="deepseek-v4-flash"
supabase secrets set DEEPSEEK_VISION_MODEL="deepseek-v4-flash-vision-exp"
```

## 历史数据

当前 5 场历史直播数据已经写入：

- `src/lib/seed.ts`
- `supabase/schema.sql`

首次运行 schema 后，数据库会自动写入这些直播场次。

旧本地版里已经生成过的 AI 分析和用户画像，需要从浏览器缓存迁移到 Supabase：

1. 保持旧版服务运行，打开 `http://127.0.0.1:8787/legacy-export.html`。
2. 点击“复制旧版缓存 JSON”。
3. 回到新版 `http://127.0.0.1:5173/`，用管理员登录。
4. 打开“原始数据”，粘贴 JSON，点击“导入粘贴内容”。

如果旧版数据刚好保存在当前新版域名下，也可以直接点击“读取当前浏览器缓存”。

## GitHub Pages 上线

本项目按 `D:\Ondoing\ondoing-web` 的 GitHub Actions 方式发布。

1. 创建 GitHub 仓库：`jinjiayi1107-afk/shangyintang-live-web`。
2. 推送项目到 `main` 分支。
3. 在仓库 Settings -> Secrets and variables -> Actions 新增：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. 在 Settings -> Pages 里选择 GitHub Actions。
5. 在 Supabase Authentication -> URL Configuration 里加入：
   - `https://jinjiayi1107-afk.github.io/shangyintang-live-web/`

上线后的访问地址预计为：

`https://jinjiayi1107-afk.github.io/shangyintang-live-web/`

## 权限

管理员：

- 上传直播 CSV
- 上传画像截图
- 识别画像
- 生成 / 重新生成 AI 复盘
- 查看全部数据

访客：

- 只能浏览看板、画像和已生成 AI 分析
- 不显示上传和 AI 生成入口
