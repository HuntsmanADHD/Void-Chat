/*
 * VoidChatApp.java — Swing desktop UI over the VoidClient core. Pure JDK
 * (javax.swing), zero dependencies. The last piece of the Void Chat JVM
 * migration: relay + crypto + client protocol + UI, all java.base/java.desktop.
 *
 * Layout:
 *   top    — relay URL, display name, Connect
 *   left   — communities (+ create), channels of the selected community
 *   center — message log for the active channel
 *   right  — roster of the active channel (double-click a member to DM)
 *   bottom — compose field + Send
 *
 * Run (from project root):
 *   javac -cp relay-java/out:seal-java/out -d client-java/out client-java/*.java
 *   java -cp relay-java/out:seal-java/out:client-java/out VoidChatApp
 */
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.swing.*;

public final class VoidChatApp {
    private final JFrame frame = new JFrame("Void Chat (Java)");
    private final JTextField relayField = new JTextField("http://127.0.0.1:3001", 22);
    private final JTextField nameField = new JTextField("anon", 10);
    private final JButton connectBtn = new JButton("Connect");
    private final JButton hostBtn = new JButton("Host over Tor");
    private final JTextField onionField = new JTextField(40);
    private final JButton copyBtn = new JButton("Copy invite");

    /** ~/.voidchat — identity, host store + onion keys, client-tor state. */
    private static final java.nio.file.Path HOME =
            java.nio.file.Path.of(System.getProperty("user.home"), ".voidchat");

    private volatile HostRuntime host;  // non-null while hosting
    private volatile Tor clientTor;     // lazily started to join other onions

    private final LocalStore store = LocalStore.inHome();
    private final JComboBox<String> quickCombo = new JComboBox<>();
    private final java.util.List<Object> quickTargets = new ArrayList<>(); // Pin or String per item
    private boolean quickRefreshing = false;
    private final JButton pinBtn = new JButton("Pin");
    private String connectedBase;              // relay base we connected to
    private volatile String pendingCommunityId; // auto-open after connect (from a pin)

    private final DefaultListModel<CommunityRef> communityModel = new DefaultListModel<>();
    private final JList<CommunityRef> communityList = new JList<>(communityModel);
    private final DefaultListModel<ChannelRef> channelModel = new DefaultListModel<>();
    private final JList<ChannelRef> channelList = new JList<>(channelModel);
    private final DefaultListModel<String> rosterModel = new DefaultListModel<>();
    private final JList<String> rosterList = new JList<>(rosterModel);

    private final JTextPane messages = new JTextPane();
    private final JTextField compose = new JTextField();
    private final JButton sendBtn = new JButton("Send");
    private final JLabel status = new JLabel("disconnected");

    /** Center: channel tab + one tab per DM conversation. */
    private final JTabbedPane centerTabs = new JTabbedPane();
    private final Map<String, JTextPane> dmLogs = new java.util.LinkedHashMap<>(); // boxPub → log
    private final Map<String, String> dmNames = new java.util.LinkedHashMap<>();  // boxPub → tab title

    private VoidClient client;
    private RelayHttpClient api;
    private volatile Identity identity;
    private final JButton identityBtn = new JButton("Identity…");
    private volatile String activeChannelId;

    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm:ss");

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            VoidChatApp app = new VoidChatApp();
            // Optional auto-pilot for quick demos/testing:
            //   VOIDCHAT_NAME=Alice          prefill display name
            //   VOIDCHAT_AUTOCONNECT=1       connect on launch
            //   VOIDCHAT_AUTOJOIN=1          join the first channel of the first community
            String name = System.getenv("VOIDCHAT_NAME");
            if (name != null && !name.isBlank()) app.nameField.setText(name.trim());
            app.show();
            if ("1".equals(System.getenv("VOIDCHAT_AUTOCONNECT"))) {
                app.autoJoin = "1".equals(System.getenv("VOIDCHAT_AUTOJOIN"));
                SwingUtilities.invokeLater(app::connect);
            }
        });
    }

    private volatile boolean autoJoin = false;
    private volatile boolean autoSent = false;

    private void show() {
        frame.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
        frame.setLayout(new BorderLayout(6, 6));

        // top bar: row 1 = connect, row 2 = hosting
        JPanel topRow1 = new JPanel(new FlowLayout(FlowLayout.LEFT));
        topRow1.add(quickCombo);
        topRow1.add(new JLabel("Relay:"));
        topRow1.add(relayField);
        topRow1.add(new JLabel("Name:"));
        topRow1.add(nameField);
        topRow1.add(connectBtn);
        topRow1.add(status);
        JPanel topRow2 = new JPanel(new FlowLayout(FlowLayout.LEFT));
        onionField.setEditable(false);
        onionField.setToolTipText("Share this with friends — they paste it into their Relay field");
        copyBtn.setEnabled(false);
        topRow2.add(hostBtn);
        topRow2.add(new JLabel("Invite:"));
        topRow2.add(onionField);
        topRow2.add(copyBtn);
        identityBtn.setEnabled(false); // enabled once the identity is loaded
        topRow2.add(identityBtn);
        JPanel top = new JPanel(new java.awt.GridLayout(2, 1));
        top.add(topRow1);
        top.add(topRow2);
        frame.add(top, BorderLayout.NORTH);

        // left: communities + channels
        JPanel left = new JPanel(new BorderLayout(4, 4));
        JButton newCommunity = new JButton("+ Community");
        JButton refresh = new JButton("Refresh");
        JPanel leftBtns = new JPanel(new FlowLayout(FlowLayout.LEFT));
        leftBtns.add(refresh);
        leftBtns.add(newCommunity);
        leftBtns.add(pinBtn);
        JSplitPane leftSplit = new JSplitPane(JSplitPane.VERTICAL_SPLIT,
                titled("Communities", communityList), titled("Channels", channelList));
        leftSplit.setResizeWeight(0.5);
        left.add(leftBtns, BorderLayout.NORTH);
        left.add(leftSplit, BorderLayout.CENTER);
        left.setPreferredSize(new Dimension(220, 0));
        frame.add(left, BorderLayout.WEST);

        // center: tabbed — channel view + per-peer DM conversations
        messages.setEditable(false);
        messages.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        JPanel channelTab = new JPanel(new BorderLayout(4, 4));
        channelTab.add(new JScrollPane(messages), BorderLayout.CENTER);
        JPanel composeBar = new JPanel(new BorderLayout(4, 4));
        composeBar.add(compose, BorderLayout.CENTER);
        composeBar.add(sendBtn, BorderLayout.EAST);
        channelTab.add(composeBar, BorderLayout.SOUTH);
        centerTabs.addTab("# channel", channelTab);
        frame.add(centerTabs, BorderLayout.CENTER);

        // right: roster
        rosterList.setPreferredSize(new Dimension(160, 0));
        frame.add(titled("In channel (2× to DM)", rosterList), BorderLayout.EAST);

        // actions
        connectBtn.addActionListener(e -> connect());
        hostBtn.addActionListener(e -> host());
        pinBtn.addActionListener(e -> togglePin());
        identityBtn.addActionListener(e -> identityDialog());
        communityList.addListSelectionListener(e -> {
            if (!e.getValueIsAdjusting()) updatePinButton();
        });
        quickCombo.addActionListener(e -> {
            if (quickRefreshing) return;
            int i = quickCombo.getSelectedIndex();
            if (i <= 0 || i > quickTargets.size()) return; // 0 = placeholder
            Object target = quickTargets.get(i - 1);
            if (target instanceof LocalStore.Pin p) {
                relayField.setText(p.relayUrl);
                pendingCommunityId = p.communityId;
            } else if (target instanceof String url) {
                relayField.setText(url);
            }
            connect();
        });
        refreshQuickCombo();
        copyBtn.addActionListener(e -> {
            java.awt.Toolkit.getDefaultToolkit().getSystemClipboard().setContents(
                new java.awt.datatransfer.StringSelection(onionField.getText()), null);
            status.setText("invite copied");
        });
        // tor runs as a child process — make sure it dies with the app
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            HostRuntime h = host;
            if (h != null) h.stop();
            Tor t = clientTor;
            if (t != null) t.stop();
        }));
        refresh.addActionListener(e -> loadCommunities());
        newCommunity.addActionListener(e -> createCommunity());
        communityList.addListSelectionListener(e -> { if (!e.getValueIsAdjusting()) openCommunity(); });
        channelList.addListSelectionListener(e -> { if (!e.getValueIsAdjusting()) openChannel(); });
        sendBtn.addActionListener(e -> sendMessage());
        compose.addActionListener(e -> sendMessage());
        rosterList.addMouseListener(new java.awt.event.MouseAdapter() {
            public void mouseClicked(java.awt.event.MouseEvent ev) {
                if (ev.getClickCount() == 2) dmSelectedMember();
            }
        });
        setConnected(false);

        frame.setSize(900, 560);
        frame.setLocationRelativeTo(null);
        frame.setVisible(true);
    }

    private JComponent titled(String title, JComponent inner) {
        JScrollPane sp = new JScrollPane(inner);
        sp.setBorder(BorderFactory.createTitledBorder(title));
        return sp;
    }

    // ── Hosting ───────────────────────────────────────────────────────

    /**
     * Boot relay + tor (HostRuntime) in ~/.voidchat/host — reusing that dir
     * keeps the store and the onion address — then connect to our own relay.
     */
    private void host() {
        hostBtn.setEnabled(false);
        new SwingWorker<HostRuntime, String>() {
            protected HostRuntime doInBackground() throws Exception {
                publish("starting relay + tor…");
                HostRuntime h = HostRuntime.start(HOME.resolve("host"),
                        (pct, s) -> publish("tor bootstrap " + pct + "%"), false);
                publish("onion identity ready — bootstrapping…");
                if (!h.awaitBootstrapped(180_000)) {
                    h.stop();
                    throw new IllegalStateException("tor did not bootstrap (network blocked?)");
                }
                return h;
            }
            protected void process(java.util.List<String> chunks) {
                status.setText(chunks.get(chunks.size() - 1));
            }
            protected void done() {
                try {
                    host = get();
                    onionField.setText(host.inviteUrl());
                    copyBtn.setEnabled(true);
                    relayField.setText("http://127.0.0.1:" + host.relayPort());
                    status.setText("hosting " + host.onion());
                    connect(); // join our own relay locally
                } catch (Exception ex) {
                    hostBtn.setEnabled(true);
                    error("host failed: " + cause(ex));
                }
            }
        }.execute();
    }

    // ── Connection ────────────────────────────────────────────────────

    /**
     * Transport policy: direct for local relays; for .onion relays reuse the
     * hosting tor's SOCKS if we're hosting, else VOIDCHAT_SOCKS if set, else
     * auto-start a client-only tor (~/.voidchat/tor-client) and wait for
     * bootstrap. Runs off the EDT because the tor path blocks for minutes.
     */
    private void connect() {
        final String base = relayField.getText().trim();
        final String name = nameField.getText().trim().isEmpty() ? "anon" : nameField.getText().trim();
        connectBtn.setEnabled(false);
        new SwingWorker<Object[], String>() {
            protected Object[] doInBackground() throws Exception {
                Transport transport = resolveTransport();
                // Identity load runs here, off the EDT: the Argon2 unlock of
                // an encrypted identity takes ~a second by design.
                java.nio.file.Path idPath = Identity.defaultPath();
                if (Identity.isEncrypted(idPath)) publish("unlocking identity…");
                Identity id = Identity.loadOrCreate(idPath, name, swingPassphraseProvider());
                if (!name.equals(id.displayName)) { id.displayName = name; id.save(idPath); }
                return new Object[] { transport, id };
            }
            private Transport resolveTransport() throws Exception {
                String env = System.getenv("VOIDCHAT_SOCKS");
                if (!base.contains(".onion"))
                    return Transport.fromSpec(env); // null/blank → DIRECT
                HostRuntime h = host;
                if (h != null)
                    return Transport.socks5("127.0.0.1", h.socksPort());
                if (env != null && !env.isBlank())
                    return Transport.fromSpec(env);
                if (clientTor == null || !clientTor.isAlive()) {
                    publish("starting tor…");
                    clientTor = Tor.startClient(HOME.resolve("tor-client"),
                            (pct, s) -> publish("tor bootstrap " + pct + "%"), 60_000, false);
                }
                publish("tor bootstrapping…");
                if (!clientTor.awaitBootstrapped(180_000))
                    throw new IllegalStateException("tor did not bootstrap (network blocked?)");
                return Transport.socks5("127.0.0.1", clientTor.socksPort());
            }
            protected void process(java.util.List<String> chunks) {
                status.setText(chunks.get(chunks.size() - 1));
            }
            protected void done() {
                try {
                    Object[] r = get();
                    finishConnect(base, name, (Transport) r[0], (Identity) r[1]);
                } catch (Exception ex) {
                    connectBtn.setEnabled(true);
                    error("connect failed: " + cause(ex));
                }
            }
        }.execute();
    }

    /** Asks for the identity passphrase on the EDT, blocking the caller. */
    private Identity.PassphraseProvider swingPassphraseProvider() {
        return retry -> {
            final char[][] result = new char[1][];
            try {
                SwingUtilities.invokeAndWait(() -> {
                    JPasswordField pf = new JPasswordField();
                    int ok = JOptionPane.showConfirmDialog(frame, pf,
                            retry ? "Wrong passphrase — try again" : "Identity passphrase",
                            JOptionPane.OK_CANCEL_OPTION);
                    result[0] = ok == JOptionPane.OK_OPTION ? pf.getPassword() : null;
                });
            } catch (Exception e) {
                return null;
            }
            return result[0];
        };
    }

    private void finishConnect(String base, String name, Transport transport, Identity id) {
        api = new RelayHttpClient(base, transport);
        identity = id;
        identityBtn.setEnabled(true);
        client = new VoidClient(id);
        client.setListener(new ClientEvents());
        client.setTransport(transport);
        String wsUri = base.replaceFirst("^http", "ws") + "/ws";
        new SwingWorker<Void, Void>() {
            protected Void doInBackground() throws Exception { client.connect(wsUri); return null; }
            protected void done() {
                try {
                    get();
                    status.setText("connecting…");
                    connectedBase = base;
                    store.rememberHost(base);
                    refreshQuickCombo();
                    updatePinButton();
                    loadCommunities();
                } catch (Exception ex) { connectBtn.setEnabled(true); error("connect failed: " + cause(ex)); }
            }
        }.execute();
    }

    private static String cause(Exception ex) {
        Throwable t = ex.getCause() != null ? ex.getCause() : ex;
        return t.getMessage() != null ? t.getMessage() : t.toString();
    }

    // ── Identity passphrase management ────────────────────────────────

    private void identityDialog() {
        Identity id = identity;
        if (id == null) return;
        boolean enc = id.hasPassphrase();
        String[] opts = enc
                ? new String[] { "Change passphrase", "Remove passphrase", "Cancel" }
                : new String[] { "Set passphrase", "Cancel" };
        int choice = JOptionPane.showOptionDialog(frame,
                "Identity file is " + (enc ? "passphrase-encrypted."
                        : "plaintext (owner-only permissions)."),
                "Identity", JOptionPane.DEFAULT_OPTION,
                JOptionPane.QUESTION_MESSAGE, null, opts, opts[0]);
        if (enc && choice == 1) { // remove
            applyPassphrase(id, null, "identity stored plaintext (0600)");
            return;
        }
        if (choice != 0) return; // cancel / closed
        JPasswordField p1 = new JPasswordField();
        JPasswordField p2 = new JPasswordField();
        Object[] form = { "New passphrase:", p1, "Repeat:", p2 };
        int ok = JOptionPane.showConfirmDialog(frame, form,
                "Encrypt identity", JOptionPane.OK_CANCEL_OPTION);
        if (ok != JOptionPane.OK_OPTION) return;
        char[] a = p1.getPassword();
        char[] b = p2.getPassword();
        boolean match = java.util.Arrays.equals(a, b);
        java.util.Arrays.fill(b, '\0');
        if (!match || a.length == 0) {
            java.util.Arrays.fill(a, '\0');
            error(a.length == 0 ? "empty passphrase" : "passphrases don't match");
            return;
        }
        applyPassphrase(id, a, "identity encrypted");
    }

    /** Runs the Argon2-heavy re-save off the EDT. Zeroizes pw afterwards. */
    private void applyPassphrase(Identity id, char[] pw, String doneMsg) {
        identityBtn.setEnabled(false);
        new SwingWorker<Void, Void>() {
            protected Void doInBackground() throws Exception {
                id.setPassphrase(pw, Identity.defaultPath());
                return null;
            }
            protected void done() {
                if (pw != null) java.util.Arrays.fill(pw, '\0');
                identityBtn.setEnabled(true);
                try { get(); status.setText(doneMsg); }
                catch (Exception ex) { error("identity save failed: " + cause(ex)); }
            }
        }.execute();
    }

    // ── Pins + recent hosts (LocalStore) ──────────────────────────────

    private void refreshQuickCombo() {
        quickRefreshing = true;
        try {
            quickCombo.removeAllItems();
            quickTargets.clear();
            quickCombo.addItem("— pinned & recent —");
            for (LocalStore.Pin p : store.pins()) {
                quickCombo.addItem("★ " + p.name + "  (" + shorten(p.relayUrl) + ")");
                quickTargets.add(p);
            }
            for (String h : store.hosts()) {
                quickCombo.addItem(shorten(h));
                quickTargets.add(h);
            }
            quickCombo.setSelectedIndex(0);
        } finally {
            quickRefreshing = false;
        }
    }

    private static String shorten(String url) {
        String s = url.replaceFirst("^https?://", "");
        return s.length() > 28 ? s.substring(0, 12) + "…" + s.substring(s.length() - 10) : s;
    }

    private void togglePin() {
        CommunityRef c = communityList.getSelectedValue();
        if (c == null || connectedBase == null) return;
        if (store.isPinned(connectedBase, c.id())) {
            store.unpin(connectedBase, c.id());
        } else {
            store.pin(new LocalStore.Pin(c.name(), connectedBase, c.id()));
        }
        updatePinButton();
        refreshQuickCombo();
    }

    private void updatePinButton() {
        CommunityRef c = communityList.getSelectedValue();
        pinBtn.setEnabled(c != null && connectedBase != null);
        pinBtn.setText(c != null && connectedBase != null && store.isPinned(connectedBase, c.id())
                ? "Unpin" : "Pin");
    }

    private void setConnected(boolean on) {
        channelList.setEnabled(on);
        communityList.setEnabled(on);
        compose.setEnabled(on);
        sendBtn.setEnabled(on);
    }

    // ── HTTP: communities + channels ──────────────────────────────────

    private void loadCommunities() {
        if (api == null) return;
        new SwingWorker<List<Object>, Void>() {
            protected List<Object> doInBackground() throws Exception { return api.listCommunities(); }
            protected void done() {
                try {
                    communityModel.clear();
                    for (Object o : get()) {
                        Map<String, Object> c = Json.asObj(o);
                        communityModel.addElement(new CommunityRef((String) c.get("id"), (String) c.get("name")));
                    }
                    if (autoJoin && !communityModel.isEmpty()) communityList.setSelectedIndex(0);
                    // A pin selection wants its community opened automatically.
                    String want = pendingCommunityId;
                    if (want != null) {
                        pendingCommunityId = null;
                        for (int i = 0; i < communityModel.size(); i++) {
                            if (communityModel.get(i).id().equals(want)) {
                                communityList.setSelectedIndex(i);
                                break;
                            }
                        }
                    }
                } catch (Exception ex) { error("load communities: " + ex.getCause()); }
            }
        }.execute();
    }

    private void createCommunity() {
        String name = JOptionPane.showInputDialog(frame, "Community name (2–64 chars):");
        if (name == null || name.isBlank()) return;
        new SwingWorker<Void, Void>() {
            protected Void doInBackground() throws Exception { api.createCommunity(name.trim(), null, null); return null; }
            protected void done() {
                try { get(); loadCommunities(); } catch (Exception ex) { error("create: " + ex.getCause()); }
            }
        }.execute();
    }

    private void openCommunity() {
        openCommunity(null);
    }

    /**
     * Open the selected community's channels. Password-gated communities:
     * try the cached password first, prompt on 401, cache what worked.
     * `entered` is a fresh user-typed password (null on the first attempt).
     */
    private void openCommunity(String entered) {
        CommunityRef c = communityList.getSelectedValue();
        if (c == null) return;
        final String cached = entered == null ? store.password(c.id()) : null;
        final String use = entered != null ? entered : cached;
        new SwingWorker<List<Object>, Void>() {
            protected List<Object> doInBackground() throws Exception {
                return Json.asArr(api.getCommunity(c.id(), use).get("channels"));
            }
            protected void done() {
                try {
                    List<Object> channels = get();
                    if (entered != null) store.rememberPassword(c.id(), entered);
                    channelModel.clear();
                    for (Object o : channels) {
                        Map<String, Object> ch = Json.asObj(o);
                        channelModel.addElement(new ChannelRef((String) ch.get("id"), (String) ch.get("name")));
                    }
                    if (autoJoin && !channelModel.isEmpty()) { autoJoin = false; channelList.setSelectedIndex(0); }
                } catch (Exception ex) {
                    if (ex.getCause() instanceof RelayHttpClient.ApiException api401
                            && api401.status == 401) {
                        if (cached != null) store.forgetPassword(c.id()); // cached one was stale
                        JPasswordField pf = new JPasswordField();
                        int ok = JOptionPane.showConfirmDialog(frame, pf,
                                "Password for " + c.name(), JOptionPane.OK_CANCEL_OPTION);
                        String typed = new String(pf.getPassword()).trim();
                        if (ok == JOptionPane.OK_OPTION && !typed.isEmpty())
                            openCommunity(typed);
                        return;
                    }
                    error("open community: " + cause(ex));
                }
            }
        }.execute();
    }

    private void openChannel() {
        ChannelRef ch = channelList.getSelectedValue();
        if (ch == null || client == null) return;
        if (activeChannelId != null) client.leave(activeChannelId);
        activeChannelId = ch.id;
        rosterModel.clear();
        messages.setText("");
        append("— joined #" + ch.name + " —");
        client.join(ch.id);
    }

    // ── Messaging ─────────────────────────────────────────────────────

    private void sendMessage() {
        String text = compose.getText().trim();
        if (text.isEmpty() || client == null || activeChannelId == null) return;
        client.sendToChannel(activeChannelId, text);
        append("[" + now() + "] you: " + text);
        compose.setText("");
    }

    private void dmSelectedMember() {
        String name = rosterList.getSelectedValue();
        if (name == null || client == null || activeChannelId == null) return;
        String boxPub = null;
        for (VoidClient.Member m : client.rosterOf(activeChannelId)) {
            if (m.displayName.equals(name)) { boxPub = m.boxPub; break; }
        }
        if (boxPub == null) return;
        dmTab(boxPub, name);
        int i = centerTabs.indexOfTab("@" + name);
        if (i >= 0) centerTabs.setSelectedIndex(i);
    }

    /**
     * Get or create the conversation tab for a DM peer. Returns the log
     * pane; creating also builds the compose row wired to sendDM.
     */
    private JTextPane dmTab(String boxPub, String name) {
        JTextPane existing = dmLogs.get(boxPub);
        if (existing != null) {
            // Peer may have renamed since the tab was made — refresh title.
            if (name != null && !name.equals(dmNames.get(boxPub))) {
                int i = centerTabs.indexOfTab("@" + dmNames.get(boxPub));
                if (i >= 0) centerTabs.setTitleAt(i, "@" + name);
                dmNames.put(boxPub, name);
            }
            return existing;
        }
        String title = name == null ? "@?" : "@" + name;
        JTextPane log = new JTextPane();
        log.setEditable(false);
        log.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        JTextField dmCompose = new JTextField();
        JButton dmSend = new JButton("Send");
        Runnable send = () -> {
            String text = dmCompose.getText().trim();
            if (text.isEmpty() || client == null) return;
            client.sendDM(boxPub, text);
            appendLine(log, "[" + now() + "] you: " + text);
            dmCompose.setText("");
        };
        dmCompose.addActionListener(e -> send.run());
        dmSend.addActionListener(e -> send.run());
        JPanel tab = new JPanel(new BorderLayout(4, 4));
        tab.add(new JScrollPane(log), BorderLayout.CENTER);
        JPanel bar = new JPanel(new BorderLayout(4, 4));
        bar.add(dmCompose, BorderLayout.CENTER);
        bar.add(dmSend, BorderLayout.EAST);
        tab.add(bar, BorderLayout.SOUTH);
        centerTabs.addTab(title, tab);
        dmLogs.put(boxPub, log);
        dmNames.put(boxPub, name);
        return log;
    }

    // ── Client events (marshalled onto the EDT) ───────────────────────

    private final class ClientEvents implements VoidClient.Listener {
        public void onReady() {
            SwingUtilities.invokeLater(() -> { status.setText("connected as " + client.displayName); setConnected(true); });
        }
        public void onChannelMessage(String channelId, String name, String box, String text, String msgId, long ts) {
            // activeChannelId is mutated on the EDT (openChannel), so the
            // filter must run there too — checking it on the WS thread races
            // a channel switch and can render into the wrong channel.
            SwingUtilities.invokeLater(() -> {
                if (!channelId.equals(activeChannelId)) return;
                append("[" + tsOrNow(ts) + "] " + name + ": " + text);
            });
        }
        public void onDM(String box, String name, String text, boolean ok, String msgId, long ts) {
            SwingUtilities.invokeLater(() -> {
                JTextPane log = dmTab(box, name);
                appendLine(log, "[" + tsOrNow(ts) + "] " + (name == null ? "?" : name)
                        + (ok ? "" : " ⚠ unverified") + ": " + text);
            });
        }
        public void onRoster(String channelId, List<String> names) {
            SwingUtilities.invokeLater(() -> {
                if ("1".equals(System.getenv("VOIDCHAT_DEBUG")))
                    System.err.println("[" + client.displayName + " roster] " + channelId + " -> " + names
                        + (channelId.equals(activeChannelId) ? "" : " (inactive)"));
                if (!channelId.equals(activeChannelId)) return;
                rosterModel.clear();
                for (String n : names) rosterModel.addElement(n);
                // Demo auto-message: once a peer is present, send once.
                String autoMsg = System.getenv("VOIDCHAT_AUTOMSG");
                if (autoMsg != null && !autoSent && names.size() >= 2) {
                    autoSent = true;
                    compose.setText(autoMsg);
                    sendMessage();
                }
            });
        }
        public void onError(String code, String message) {
            SwingUtilities.invokeLater(() -> append("⚠ " + code + ": " + message));
        }
        public void onClosed() {
            SwingUtilities.invokeLater(() -> { status.setText("disconnected"); setConnected(false); });
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private void append(String line) {
        appendLine(messages, line);
        if ("1".equals(System.getenv("VOIDCHAT_DEBUG")))
            System.err.println("[" + (client == null ? "?" : client.displayName) + " ui] " + line);
    }

    /** O(1) append via the Document API (setText(getText()+…) is O(n²)). */
    private static void appendLine(JTextPane pane, String line) {
        try {
            javax.swing.text.Document doc = pane.getDocument();
            doc.insertString(doc.getLength(), (doc.getLength() == 0 ? "" : "\n") + line, null);
            pane.setCaretPosition(doc.getLength());
        } catch (javax.swing.text.BadLocationException ignored) {
        }
    }

    private void error(Object msg) {
        status.setText("error");
        append("⚠ " + msg);
    }

    private static String now() { return LocalTime.now().format(HM); }

    /** Relay timestamp → local HH:mm:ss; falls back to now() if absent. */
    private static String tsOrNow(long ts) {
        if (ts <= 0) return now();
        return java.time.Instant.ofEpochMilli(ts)
                .atZone(java.time.ZoneId.systemDefault()).toLocalTime().format(HM);
    }

    private record CommunityRef(String id, String name) {
        public String toString() { return name; }
    }
    private record ChannelRef(String id, String name) {
        public String toString() { return "# " + name; }
    }
}
