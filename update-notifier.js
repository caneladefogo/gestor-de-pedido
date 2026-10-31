(function () {
    // Cada aba compara o deploy carregado com a versão atualmente publicada.
    const CHECK_INTERVAL_MS = 45000;
    let loadedVersion = null;
    let checking = false;

    async function checkForUpdate() {
        if (checking || !navigator.onLine) return;
        checking = true;
        try {
            const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();
            const version = String(data.version || '');
            if (!version) return;
            if (!loadedVersion) {
                loadedVersion = version;
                return;
            }
            if (version !== loadedVersion && sessionStorage.getItem('canela_update_dismissed') !== version) {
                showUpdateNotice(version);
            }
        } catch (error) {
            console.warn('Não foi possível verificar atualização:', error);
        } finally {
            checking = false;
        }
    }

    function showUpdateNotice(version) {
        if (document.getElementById('canela-update-notice')) return;
        const notice = document.createElement('section');
        notice.id = 'canela-update-notice';
        notice.setAttribute('role', 'alert');
        notice.setAttribute('aria-live', 'assertive');
        notice.innerHTML = `
            <div class="canela-update-copy">
                <strong>✨ Nova versão disponível</strong>
                <span>Atualize para receber as últimas melhorias.</span>
            </div>
            <div class="canela-update-actions">
                <button type="button" data-action="later">Depois</button>
                <button type="button" data-action="reload">Atualizar agora</button>
            </div>`;

        const style = document.createElement('style');
        style.id = 'canela-update-style';
        style.textContent = `
            #canela-update-notice { position: fixed; left: 50%; bottom: 92px; z-index: 2147483000; transform: translateX(-50%); width: min(92vw, 560px); box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border: 2px solid #ffbf00; border-radius: 16px; background: #2b2929; color: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.34); font-family: Inter, Arial, sans-serif; }
            #canela-update-notice .canela-update-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            #canela-update-notice strong { color: #ffbf00; font-size: 16px; }
            #canela-update-notice span { font-size: 13px; line-height: 1.3; }
            #canela-update-notice .canela-update-actions { display: flex; gap: 8px; flex-shrink: 0; }
            #canela-update-notice button { min-height: 42px; padding: 9px 13px; border: 0; border-radius: 10px; font: 700 13px Inter, Arial, sans-serif; cursor: pointer; }
            #canela-update-notice button[data-action="later"] { background: #f2eeee; color: #650c12; }
            #canela-update-notice button[data-action="reload"] { background: #ffbf00; color: #4c090e; }
            @media (max-width: 600px) { #canela-update-notice { bottom: 86px; flex-direction: column; align-items: stretch; gap: 10px; } #canela-update-notice .canela-update-actions { display: grid; grid-template-columns: 1fr 1fr; } }
        `;
        document.head.appendChild(style);
        document.body.appendChild(notice);

        notice.querySelector('[data-action="later"]').addEventListener('click', () => {
            sessionStorage.setItem('canela_update_dismissed', version);
            notice.remove();
        });
        notice.querySelector('[data-action="reload"]').addEventListener('click', () => {
            const url = new URL(location.href);
            url.searchParams.set('build', version.slice(0, 12));
            location.replace(url.toString());
        });
    }

    setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkForUpdate);
    window.addEventListener('online', checkForUpdate);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkForUpdate();
    });
    setTimeout(checkForUpdate, 0);
})();
