# Deploying weatherV1-next on Oracle Cloud Always Free

A production-ready, zero-cost deploy of the Next.js port to an Oracle Cloud Ampere A1 VM using the included `Dockerfile` and `docker-compose.yml`. Free forever within the Always Free envelope (4 ARM OCPU / 24 GB RAM / 200 GB disk / 10 TB egress per month).

The companion design doc is `DESIGN_DEPLOYMENT.md`.

## TL;DR

1. Sign up at https://cloud.oracle.com/free.
2. Launch a `VM.Standard.A1.Flex` instance — 4 OCPU / 24 GB RAM, Ubuntu 24.04 (ARM), 200 GB boot volume.
3. Open ports 80/443 in the VCN security list **and** the host iptables.
4. Install Docker.
5. Clone the repo to `/opt/weather/weatherv1-next`; rsync the `v1Drive/` media tree as a sibling at `/opt/weather/v1Drive/`.
6. `cd /opt/weather/weatherv1-next && cp .env.example .env && nano .env && docker compose up -d --build`.
7. Caddy reverse-proxy `:443` → `localhost:3000` for HTTPS (optional, if you have a domain).

Total cost: **$0/month forever** as long as the account stays in the Always Free envelope.

## Why Oracle Cloud (vs Vercel / v0 / Render / Fly / Railway)

| Platform | Native ffmpeg | Persistent disk | Long-running worker | Free forever | Verdict |
|---|---|---|---|---|---|
| **Oracle Cloud Always Free** | yes (apt) | yes (200 GB) | yes (real VM) | yes | Use this |
| Vercel / v0 | no (250 MB cap) | no (/tmp only, ephemeral) | no (stateless) | yes (tiny) | Won't run |
| Render Free | no | no (paid only) | no (sleeps after 15 min) | yes | Won't run |
| Fly.io | yes | yes (paid) | yes | no (trial only since 2024) | Paid |
| Railway / Heroku / Koyeb | yes | yes (paid) | yes | no (trial credit) | Paid |
| Hetzner CX22 (~€4.59/mo) | yes | yes (40 GB) | yes | no | **Fallback if A1 capacity blocked** |

`weatherV1-next` needs native ffmpeg, a persistent filesystem (`runtime/jobs.json`, uploads, outputs, poster cache), and a long-lived Node process for the in-memory worker queue. Only a real VM ticks all three boxes; Oracle's A1 is the only free option that's also generous enough to comfortably render 1080×1920 H.264 video.

## Before you start

- Repo cloned on your laptop (build host).
- OpenAI API key with Whisper + GPT-4o access.
- A credit card and a phone number for Oracle signup. **The card is never charged unless you explicitly click Upgrade** — see "Billing safety" below.
- The `v1Drive/weather/` media tree on disk (catalog + videos + music).

## 1. Sign up and pick a home region

Go to https://cloud.oracle.com/free. Choose a **home region with A1 capacity**. As of May 2026, the most reliable picks:

- US East (Ashburn) — most stable
- US West (Phoenix) — second most stable
- Stockholm, Zurich, Madrid, Mexico Querétaro — usually have stock
- London, Frankfurt, Tokyo, Singapore, Sydney, Mumbai — often starved

Home region is set once and is awkward to change later, so pick one with stock.

## 2. Provision the VM

In the OCI Console: **Compute → Instances → Create instance**.

- **Image**: Canonical Ubuntu 24.04 (ARM build)
- **Shape**: Click "Change shape" → "Ampere" → `VM.Standard.A1.Flex` → 4 OCPUs / 24 GB memory
- **Networking**: "Create new virtual cloud network" (defaults are fine — that gets you a VCN with an internet gateway, public subnet, and a default security list)
- **SSH keys**: upload `~/.ssh/id_ed25519.pub` (or generate one)
- **Boot volume**: 200 GB (the free tier ceiling; larger costs money)

Click Create. If you see "Out of host capacity" — Oracle has no A1 stock right now. Workarounds:

- Try a different availability domain.
- Use the [hitrov/oci-arm-host-capacity](https://github.com/hitrov/oci-arm-host-capacity) retry script — it polls the API until capacity opens up.
- Retry manually every few hours.
- Switch home region (one-time, in account settings).

## 3. Open ports 80 and 443

Oracle blocks everything except SSH by default at **both** the VCN security list AND the host iptables. You must open both.

**VCN security list** (Console):

- Networking → Virtual Cloud Networks → your VCN → Security Lists → Default Security List → Add Ingress Rules:
  - Source `0.0.0.0/0`, Protocol TCP, Destination Port Range `80,443`

**Host iptables** (over SSH):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

UFW alone is **not enough** on Oracle Ubuntu images — they ship with iptables managing things directly, and UFW rules sit on top without unblocking the default `INPUT` deny.

## 4. Install Docker

```bash
ssh ubuntu@<your-vm-public-ip>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker
docker run --rm hello-world
```

## 5. Clone the repo and place the media tree

```bash
sudo mkdir -p /opt/weather
sudo chown ubuntu:ubuntu /opt/weather
cd /opt/weather
git clone https://github.com/barmoshe/weatherv1-next.git weatherv1-next
```

Then, from your laptop, push the media tree:

```bash
rsync -avh --progress v1Drive/ ubuntu@<your-vm-public-ip>:/opt/weather/v1Drive/
```

Verify on the VM:

```bash
ls /opt/weather/v1Drive/weather/
# expected: audio  music  notouch!  videos
```

## 6. Configure environment and start the app

```bash
cd /opt/weather/weatherv1-next
cp .env.example .env
nano .env   # paste OPENAI_API_KEY (and GEMINI_API_KEY if you have one)

docker compose up -d --build
docker compose logs -f
```

The first build takes a few minutes (ffmpeg + Next compile). When the log shows `Listening on http://0.0.0.0:3000`, hit `http://<public-ip>:3000/api/config` from your laptop — should return a small JSON blob. The app is live.

### Building on a different architecture

If you're building the image somewhere other than the Oracle ARM VM (e.g. on an x86 laptop) and want to pre-bake it for ARM:

```bash
docker buildx build --platform linux/arm64 -t weatherv1-next:arm64 .
```

The `Dockerfile`'s `--platform=$BUILDPLATFORM` lines support cross-compilation on Apple Silicon and amd64 hosts.

## 7. HTTPS with Caddy (optional, requires a domain)

If you have a domain pointing at the VM's public IP:

```bash
sudo apt update && sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile <<'EOF'
weather.example.com {
  reverse_proxy localhost:3000
}
EOF
sudo systemctl reload caddy
```

Caddy auto-provisions a Let's Encrypt cert and starts serving HTTPS on `:443`. No further config needed.

## 8. Operations

### Updating to a new commit

```bash
cd /opt/weather/weatherv1-next
git pull
docker compose up -d --build
```

### Logs

```bash
docker compose logs -f --tail=200
```

### Backups

Persistent state lives in two places on the host:

- `/opt/weather/v1Drive/` — catalog + media
- `/opt/weather/weatherv1-next/runtime/` — jobs.json, uploads, outputs, caches

The Always Free tier includes **5 free incremental block-volume backups**. Set up a weekly policy in **Block Storage → Backup Policies**. For irreplaceable data (your catalog), also `rclone` nightly to Cloudflare R2 or Backblaze B2 — both have free tiers larger than the catalog plus a comfort margin.

### Monitoring

- `docker compose logs -f` — application logs
- `docker stats` — container CPU/memory
- OCI Console → Monitoring → Metrics — free per-instance CPU, memory, disk, network graphs
- Watch the **10 TB/month egress meter** in OCI billing if outputs get downloaded heavily

## 9. Capacity and billing safety

**Always Free does not auto-upgrade.** Even with a credit card on file, OCI never charges you unless you explicitly click "Upgrade" in the Console banner. See the [Oracle Free Tier FAQ](https://www.oracle.com/cloud/free/faq/). Do not click Upgrade.

**A1 ARM instances are NOT reclaimed for idleness.** Only the AMD `VM.Standard.E2.1.Micro` shape gets reaped after 7 days idle. Your A1 stays running forever as long as it stays within Always Free limits.

Cautionary read: [HN thread about accidental upgrades](https://news.ycombinator.com/item?id=29514359). The pattern is usually clicking the wrong button — not silent upgrades. Stay in the Always Free console view.

## 10. Cost ceiling if you outgrow the free tier

If usage ever spills past Always Free (e.g. >10 TB egress in a month), OCI pauses services until you upgrade. PAYG pricing for the same 4 OCPU / 24 GB shape is roughly:

- Compute: 4 OCPU × ~$0.01/hr × 730 hr ≈ $29
- RAM: 24 GB × ~$0.0015/hr × 730 hr ≈ $26
- Disk + egress: ~$3
- **Total: ~$58/month**

At that point a **Hetzner CX22 (~€4.59/mo, dedicated 2 vCPU, 4 GB RAM, 40 GB SSD)** beats Oracle on price-per-perf. The same `docker-compose` setup works there — only the firewall step is simpler (UFW is fine on Hetzner Ubuntu images).

## Appendix: sources

- [Oracle Cloud Always Free Resources (official docs)](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)
- [hitrov/oci-arm-host-capacity (capacity retry script)](https://github.com/hitrov/oci-arm-host-capacity)
- [Opening ports 80/443 on an Oracle Cloud instance](https://marcinmitruk.link/posts/how-to-open-ports-80-and-443-on-an-oracle-cloud-instance/)
- [Enabling network traffic to Ubuntu in OCI (Oracle blog)](https://blogs.oracle.com/developers/enabling-network-traffic-to-ubuntu-images-in-oracle-cloud-infrastructure)
- [Setup Always Free VPS guide (Medium)](https://medium.com/@imvinojanv/setup-always-free-vps-with-4-ocpu-24gb-ram-and-200gb-storage-the-ultimate-oracle-cloud-guide-bed5cbf73d34)
- [Hetzner Cloud pricing 2026](https://costgoat.com/pricing/hetzner)
- [HN thread on Oracle free tier upgrades](https://news.ycombinator.com/item?id=29514359)
