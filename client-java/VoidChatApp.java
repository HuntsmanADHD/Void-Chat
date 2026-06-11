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
import java.util.List;
import java.util.Map;
import javax.swing.*;

public final class VoidChatApp {
    private final JFrame frame = new JFrame("Void Chat (Java)");
    private final JTextField relayField = new JTextField("http://127.0.0.1:3001", 22);
    private final JTextField nameField = new JTextField("anon", 10);
    private final JButton connectBtn = new JButton("Connect");

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

    private VoidClient client;
    private RelayHttpClient api;
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

        // top bar
        JPanel top = new JPanel(new FlowLayout(FlowLayout.LEFT));
        top.add(new JLabel("Relay:"));
        top.add(relayField);
        top.add(new JLabel("Name:"));
        top.add(nameField);
        top.add(connectBtn);
        top.add(status);
        frame.add(top, BorderLayout.NORTH);

        // left: communities + channels
        JPanel left = new JPanel(new BorderLayout(4, 4));
        JButton newCommunity = new JButton("+ Community");
        JButton refresh = new JButton("Refresh");
        JPanel leftBtns = new JPanel(new FlowLayout(FlowLayout.LEFT));
        leftBtns.add(refresh);
        leftBtns.add(newCommunity);
        JSplitPane leftSplit = new JSplitPane(JSplitPane.VERTICAL_SPLIT,
                titled("Communities", communityList), titled("Channels", channelList));
        leftSplit.setResizeWeight(0.5);
        left.add(leftBtns, BorderLayout.NORTH);
        left.add(leftSplit, BorderLayout.CENTER);
        left.setPreferredSize(new Dimension(220, 0));
        frame.add(left, BorderLayout.WEST);

        // center: messages + compose
        messages.setEditable(false);
        messages.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        JPanel center = new JPanel(new BorderLayout(4, 4));
        center.add(new JScrollPane(messages), BorderLayout.CENTER);
        JPanel composeBar = new JPanel(new BorderLayout(4, 4));
        composeBar.add(compose, BorderLayout.CENTER);
        composeBar.add(sendBtn, BorderLayout.EAST);
        center.add(composeBar, BorderLayout.SOUTH);
        frame.add(center, BorderLayout.CENTER);

        // right: roster
        rosterList.setPreferredSize(new Dimension(160, 0));
        frame.add(titled("In channel (2× to DM)", rosterList), BorderLayout.EAST);

        // actions
        connectBtn.addActionListener(e -> connect());
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

    // ── Connection ────────────────────────────────────────────────────

    private void connect() {
        String base = relayField.getText().trim();
        String name = nameField.getText().trim();
        if (name.isEmpty()) { name = "anon"; }
        // VOIDCHAT_SOCKS=host:port routes everything through a SOCKS5 proxy
        // (Tor: 127.0.0.1:9050). Required when the relay is an .onion.
        Transport transport;
        try {
            transport = Transport.fromSpec(System.getenv("VOIDCHAT_SOCKS"));
        } catch (RuntimeException ex) {
            error("bad VOIDCHAT_SOCKS: " + ex.getMessage());
            return;
        }
        if (base.contains(".onion") && !transport.isProxied()) {
            error(".onion relay needs VOIDCHAT_SOCKS=127.0.0.1:9050 (a running Tor)");
            return;
        }
        api = new RelayHttpClient(base, transport);
        try {
            // Persistent identity: same keys across restarts. The name field
            // is authoritative — update + re-save if the user changed it.
            java.nio.file.Path idPath = Identity.defaultPath();
            Identity id = Identity.loadOrCreate(idPath, name);
            if (!name.equals(id.displayName)) { id.displayName = name; id.save(idPath); }
            client = new VoidClient(id);
        } catch (Exception ex) {
            error("identity load failed: " + ex.getMessage());
            return;
        }
        client.setListener(new ClientEvents());
        client.setTransport(transport);
        String wsUri = base.replaceFirst("^http", "ws") + "/ws";
        new SwingWorker<Void, Void>() {
            protected Void doInBackground() throws Exception { client.connect(wsUri); return null; }
            protected void done() {
                try { get(); status.setText("connecting…"); loadCommunities(); }
                catch (Exception ex) { error("connect failed: " + ex.getCause()); }
            }
        }.execute();
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
        CommunityRef c = communityList.getSelectedValue();
        if (c == null) return;
        new SwingWorker<List<Object>, Void>() {
            protected List<Object> doInBackground() throws Exception {
                return Json.asArr(api.getCommunity(c.id, null).get("channels"));
            }
            protected void done() {
                try {
                    channelModel.clear();
                    for (Object o : get()) {
                        Map<String, Object> ch = Json.asObj(o);
                        channelModel.addElement(new ChannelRef((String) ch.get("id"), (String) ch.get("name")));
                    }
                    if (autoJoin && !channelModel.isEmpty()) { autoJoin = false; channelList.setSelectedIndex(0); }
                } catch (Exception ex) { error("open community: " + ex.getCause()); }
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
        String text = JOptionPane.showInputDialog(frame, "DM to " + name + ":");
        if (text == null || text.isBlank()) return;
        client.sendDM(boxPub, text.trim());
        append("[" + now() + "] you → " + name + " (DM): " + text.trim());
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
                append("[" + now() + "] " + name + ": " + text);
            });
        }
        public void onDM(String box, String name, String text, boolean ok, String msgId, long ts) {
            SwingUtilities.invokeLater(() ->
                append("[" + now() + "] " + (name == null ? "?" : name) + " (DM" + (ok ? "" : " ⚠ unverified") + "): " + text));
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
        messages.setText(messages.getText() + (messages.getText().isEmpty() ? "" : "\n") + line);
        messages.setCaretPosition(messages.getDocument().getLength());
        if ("1".equals(System.getenv("VOIDCHAT_DEBUG")))
            System.err.println("[" + client.displayName + " ui] " + line);
    }

    private void error(Object msg) {
        status.setText("error");
        append("⚠ " + msg);
    }

    private static String now() { return LocalTime.now().format(HM); }

    private record CommunityRef(String id, String name) {
        public String toString() { return name; }
    }
    private record ChannelRef(String id, String name) {
        public String toString() { return "# " + name; }
    }
}
