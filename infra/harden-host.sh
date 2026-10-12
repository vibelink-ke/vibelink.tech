#!/usr/bin/env bash
# Host hardening for the VPS that runs this stack. Safe to re-run.
#
#   sudo ./infra/harden-host.sh            # shows what it would change, changes nothing
#   sudo ./infra/harden-host.sh --apply    # does it
#
# Keep a second SSH session open while you apply it, so a mistake never locks you out.
#
# What it does:
#   - firewall (ufw): everything inbound is refused except SSH (rate-limited), web (80/443), the router tunnels (OpenVPN 1194/tcp,
#     WireGuard 51820/udp), RADIUS (1812-1813/udp) and TR-069 (7547/tcp)
#   - fail2ban: bans an address that keeps failing SSH logins
#   - SSH: no password logins and no root password login, but only when a key is already installed for you, so it cannot lock you out
#   - kernel: SYN-flood protection and spoofed-address filtering
#   - automatic security updates
#
# Docker publishes its own ports around ufw, so ufw alone does not cover containers. The database port is therefore bound to
# 127.0.0.1 in docker-compose.yml, not left to the firewall.
set -euo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
run() { if [ "$APPLY" -eq 1 ]; then echo "+ $*"; "$@"; else echo "would run: $*"; fi; }

echo "== packages"
run apt-get install -y ufw fail2ban unattended-upgrades

echo "== firewall"
run ufw default deny incoming
run ufw default allow outgoing
# The port SSH is really listening on (not assumed to be 22), so the firewall can never close the door you came in by.
SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port /{print $2}' | head -1); SSH_PORT=${SSH_PORT:-22}
echo "SSH port: $SSH_PORT"
run ufw limit "${SSH_PORT}/tcp"
for r in 80/tcp 443/tcp 1194/tcp 51820/udp 1812:1813/udp 7547/tcp; do run ufw allow "$r"; done
run ufw --force enable

echo "== fail2ban"
if [ "$APPLY" -eq 1 ]; then
  cat > /etc/fail2ban/jail.d/sshd.local <<'JAIL'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
JAIL
  systemctl enable --now fail2ban
else
  echo "would write /etc/fail2ban/jail.d/sshd.local (5 failures in 10 minutes = 1 hour ban) and start fail2ban"
fi

echo "== ssh"
WHO="${SUDO_USER:-root}"; HOME_DIR=$(getent passwd "$WHO" | cut -d: -f6)
if [ -s "$HOME_DIR/.ssh/authorized_keys" ]; then
  if [ "$APPLY" -eq 1 ]; then
    # Named 00- on purpose: sshd keeps the FIRST value it reads for a setting, and files load in name order, so a 50-cloud-init.conf
    # saying PasswordAuthentication yes beat a 99- file and left passwords on.
    rm -f /etc/ssh/sshd_config.d/99-hardening.conf
    cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 4
LoginGraceTime 30
SSH
    sshd -t && { systemctl reload ssh || systemctl reload sshd; }
    if sshd -T | grep -qi '^passwordauthentication no'; then echo "SSH passwords are off"; else echo "WARNING: sshd still allows passwords. Look at: grep -ri PasswordAuthentication /etc/ssh/sshd_config /etc/ssh/sshd_config.d/"; fi
  else
    echo "would turn off SSH password logins (a key is installed for $WHO)"
  fi
else
  echo "SKIPPED: no key in $HOME_DIR/.ssh/authorized_keys, so password logins stay on. Add a key first, then run this again."
fi

echo "== kernel"
if [ "$APPLY" -eq 1 ]; then
  cat > /etc/sysctl.d/99-hardening.conf <<'SYS'
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
SYS
  sysctl --system >/dev/null
else
  echo "would write /etc/sysctl.d/99-hardening.conf (SYN cookies, spoof filtering)"
fi

echo "== automatic security updates"
run dpkg-reconfigure -f noninteractive unattended-upgrades

echo; [ "$APPLY" -eq 1 ] && echo "Done. Check: ufw status verbose; fail2ban-client status sshd" || echo "Nothing changed. Run again with --apply."
