'use strict';

/**
 * Renderer logic for the launcher window ONLY — talks exclusively through
 * `window.erp` (see `preload.ts`). No `fetch`/network calls happen here
 * (the launcher's CSP forbids it, `connect-src 'none'`); every network
 * check is delegated to the main process via IPC. Deliberately plain JS,
 * no build step, no framework — Prompt #20 §4 asks for a tiny operational
 * launcher, not a second frontend app.
 */
(function () {
  var LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

  function isLoopback(host) {
    return LOOPBACK_HOSTS.indexOf(host) !== -1;
  }

  function workspaceLabel(workspace) {
    return workspace === 'gestion' ? 'Gestión' : 'Facturación';
  }

  function overallDotClass(overall) {
    if (overall === 'connected') return 'ok';
    if (overall === 'degraded') return 'warn';
    return 'error';
  }

  function overallLabel(overall) {
    if (overall === 'connected') return 'Conectado';
    if (overall === 'degraded') return 'Incompleto';
    return 'Sin conexión';
  }

  function statusText(status) {
    switch (status) {
      case 'ok':
        return 'OK';
      case 'degraded':
        return 'Degradado';
      case 'error':
        return 'Error';
      case 'unreachable':
        return 'Sin respuesta';
      default:
        return status;
    }
  }

  var els = {
    configScreen: document.getElementById('config-screen'),
    homeScreen: document.getElementById('home-screen'),
    serverInput: document.getElementById('server-input'),
    configError: document.getElementById('config-error'),
    testResult: document.getElementById('test-result'),
    testOverallDot: document.getElementById('test-overall-dot'),
    testOverallLabel: document.getElementById('test-overall-label'),
    testRowApi: document.getElementById('test-row-api'),
    testRowGestion: document.getElementById('test-row-gestion'),
    testRowFacturacion: document.getElementById('test-row-facturacion'),
    tlsWarning: document.getElementById('tls-warning'),
    testConnectionBtn: document.getElementById('test-connection'),
    saveServerBtn: document.getElementById('save-server'),
    cancelConfigBtn: document.getElementById('cancel-config'),
    homeHost: document.getElementById('home-host'),
    homeStatusDot: document.getElementById('home-status-dot'),
    homeStatusLabel: document.getElementById('home-status-label'),
    homeTlsWarning: document.getElementById('home-tls-warning'),
    openGestionBtn: document.getElementById('open-gestion'),
    openFacturacionBtn: document.getElementById('open-facturacion'),
    homeOpenError: document.getElementById('home-open-error'),
    reconfigureBtn: document.getElementById('reconfigure-server'),
    createShortcutsBtn: document.getElementById('create-shortcuts'),
    shortcutsResult: document.getElementById('shortcuts-result'),
    loadErrorBanner: document.getElementById('load-error-banner'),
    loadErrorWorkspace: document.getElementById('load-error-workspace'),
    loadErrorHost: document.getElementById('load-error-host'),
    loadErrorRetry: document.getElementById('load-error-retry'),
    loadErrorHome: document.getElementById('load-error-home'),
    loadErrorConfigure: document.getElementById('load-error-configure'),
    appVersion: document.getElementById('app-version'),
  };

  var state = {
    config: null,
    draftConfig: null,
    lastFailedWorkspace: null,
  };

  function show(el) {
    el.hidden = false;
  }
  function hide(el) {
    el.hidden = true;
  }

  function showConfigScreen() {
    hide(els.homeScreen);
    show(els.configScreen);
    els.saveServerBtn.disabled = true;
    hide(els.testResult);
    hide(els.configError);
    state.draftConfig = null;
    if (state.config) {
      els.serverInput.value = state.config.host;
      els.cancelConfigBtn.hidden = false;
    } else {
      els.serverInput.value = '';
      els.cancelConfigBtn.hidden = true;
    }
    els.serverInput.focus();
  }

  function showHomeScreen() {
    hide(els.configScreen);
    show(els.homeScreen);
    hide(els.homeOpenError);
    renderHome();
  }

  function renderHome() {
    if (!state.config) return;
    els.homeHost.textContent = state.config.host;
    var loopback = isLoopback(state.config.host);
    if (state.config.scheme === 'http' && !loopback) {
      show(els.homeTlsWarning);
    } else {
      hide(els.homeTlsWarning);
    }
    els.createShortcutsBtn.hidden = !state.isWindows;
  }

  function renderConnectionResult(target, prefix, connection) {
    show(target);
    var dot = document.getElementById(prefix + '-overall-dot');
    var label = document.getElementById(prefix + '-overall-label');
    dot.className = 'status-dot ' + overallDotClass(connection.overall);
    label.textContent = overallLabel(connection.overall);
    document.getElementById(prefix + '-row-api').textContent = statusText(connection.api.status);
    document.getElementById(prefix + '-row-gestion').textContent = statusText(connection.gestion.status);
    document.getElementById(prefix + '-row-facturacion').textContent = statusText(
      connection.facturacion.status,
    );
  }

  function updateHomeStatus(connection) {
    els.homeStatusDot.className = 'status-dot ' + overallDotClass(connection.overall);
    els.homeStatusLabel.textContent = overallLabel(connection.overall);
  }

  async function refreshHomeStatus() {
    if (!state.config) return;
    var result = await window.erp.testServer(
      state.config.scheme + '://' + state.config.host,
    );
    if (result.ok) updateHomeStatus(result.connection);
  }

  async function onTestConnection() {
    hide(els.configError);
    hide(els.testResult);
    els.saveServerBtn.disabled = true;
    state.draftConfig = null;
    els.testConnectionBtn.disabled = true;
    try {
      var result = await window.erp.testServer(els.serverInput.value);
      if (!result.ok) {
        els.configError.textContent = result.error;
        show(els.configError);
        return;
      }
      state.draftConfig = result.config;
      renderConnectionResult(els.testResult, 'test', result.connection);
      var loopback = isLoopback(result.config.host);
      if (result.config.scheme === 'http' && !loopback) {
        show(els.tlsWarning);
      } else {
        hide(els.tlsWarning);
      }
      // Only a fully unreachable API blocks saving outright — a
      // "degraded"/partial result still lets an admin save and retry
      // later (Prompt #20 §20: "Incompleto" is a real, useful state).
      // `overall` is 'unreachable' exactly when the API itself is
      // (see `computeOverall` in health.ts).
      els.saveServerBtn.disabled = result.connection.overall === 'unreachable';
    } finally {
      els.testConnectionBtn.disabled = false;
    }
  }

  async function onSaveServer() {
    if (!state.draftConfig) return;
    els.saveServerBtn.disabled = true;
    var result = await window.erp.saveServer(state.draftConfig);
    if (!result.ok) {
      els.configError.textContent = result.error || 'No se pudo guardar la configuración.';
      show(els.configError);
      els.saveServerBtn.disabled = false;
      return;
    }
    state.config = state.draftConfig;
    state.draftConfig = null;
    showHomeScreen();
    void refreshHomeStatus();
  }

  function onCancelConfig() {
    if (!state.config) return;
    showHomeScreen();
  }

  async function onOpenWorkspace(workspace) {
    hide(els.homeOpenError);
    var result = await window.erp.openWorkspace(workspace);
    if (!result.ok) {
      els.homeOpenError.textContent = result.error || 'No se pudo abrir ' + workspaceLabel(workspace) + '.';
      show(els.homeOpenError);
    }
  }

  async function onCreateShortcuts() {
    els.createShortcutsBtn.disabled = true;
    var result = await window.erp.createWorkspaceShortcuts();
    els.shortcutsResult.textContent = result.ok
      ? 'Accesos directos creados en el Escritorio.'
      : result.error || 'No se pudieron crear los accesos directos.';
    show(els.shortcutsResult);
    els.createShortcutsBtn.disabled = false;
  }

  function showLoadErrorBanner(workspace, host) {
    state.lastFailedWorkspace = workspace;
    els.loadErrorWorkspace.textContent = workspaceLabel(workspace);
    els.loadErrorHost.textContent = host;
    show(els.loadErrorBanner);
  }

  function hideLoadErrorBanner() {
    hide(els.loadErrorBanner);
    state.lastFailedWorkspace = null;
  }

  async function init() {
    var info = await window.erp.getAppInfo();
    els.appVersion.textContent = 'ERP v' + info.version;
    state.isWindows = info.platform === 'win32';

    state.config = await window.erp.getDesktopConfig();
    if (state.config) {
      showHomeScreen();
      void refreshHomeStatus();
    } else {
      showConfigScreen();
    }

    window.erp.onWorkspaceLoadFailed(function (payload) {
      showLoadErrorBanner(payload.workspace, payload.host);
    });
    window.erp.onShowConfigScreen(function () {
      showConfigScreen();
    });
  }

  els.testConnectionBtn.addEventListener('click', function () {
    void onTestConnection();
  });
  els.saveServerBtn.addEventListener('click', function () {
    void onSaveServer();
  });
  els.cancelConfigBtn.addEventListener('click', onCancelConfig);
  els.openGestionBtn.addEventListener('click', function () {
    void onOpenWorkspace('gestion');
  });
  els.openFacturacionBtn.addEventListener('click', function () {
    void onOpenWorkspace('facturacion');
  });
  els.reconfigureBtn.addEventListener('click', showConfigScreen);
  els.createShortcutsBtn.addEventListener('click', function () {
    void onCreateShortcuts();
  });
  els.serverInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') void onTestConnection();
  });

  els.loadErrorRetry.addEventListener('click', function () {
    var workspace = state.lastFailedWorkspace;
    hideLoadErrorBanner();
    if (workspace) void onOpenWorkspace(workspace);
  });
  els.loadErrorHome.addEventListener('click', hideLoadErrorBanner);
  els.loadErrorConfigure.addEventListener('click', function () {
    hideLoadErrorBanner();
    showConfigScreen();
  });

  void init();
})();
