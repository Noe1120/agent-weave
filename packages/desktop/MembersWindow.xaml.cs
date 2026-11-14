using System.Windows;
using System.Windows.Input;
using Team.Core;
namespace Team;

public partial class MembersWindow : Window
{
    readonly string project;
    readonly Func<IWorkspaceApi> api;
    readonly Func<Task> reconnect;
    bool busy;
    public MembersWindow(Window owner, string project, Func<IWorkspaceApi> api, Func<Task> reconnect) { InitializeComponent(); Owner = owner; this.project = project; this.api = api; this.reconnect = reconnect; Closing += (_, e) => { if (busy) e.Cancel = true; }; }
    async Task Run(Func<Task> action) { if (busy) return; busy = true; Feedback.Text = ""; try { await action(); } catch (Exception ex) { Feedback.Text = FormWindow.Explain(ex); } finally { busy = false; } }
    async Task Load() { var selected = (MemberList.SelectedItem as Member)?.Id; var snapshot = await api().GetAsync<ProjectSnapshot>("projects/" + project); MemberList.ItemsSource = snapshot.Members; MemberList.SelectedItem = snapshot.Members.FirstOrDefault(x => x.Id == selected); Empty.Visibility = snapshot.Members.Length == 0 ? Visibility.Visible : Visibility.Collapsed; }
    async Task Saved() { try { await Load(); } catch (Exception ex) { Feedback.Text = "已保存，但刷新失败。\n" + FormWindow.Explain(ex); } }
    async void OnLoaded(object sender, RoutedEventArgs e) => await Run(Load);
    async void RefreshClick(object sender, RoutedEventArgs e) => await Run(Load);
    async void AddClick(object sender, RoutedEventArgs e) => await Edit(null);
    async void EditClick(object sender, RoutedEventArgs e) { if (MemberList.SelectedItem is Member m) await Edit(m); else Feedback.Text = "请选择一个成员。"; }
    void DoubleClick(object sender, MouseButtonEventArgs e) { if (MemberList.SelectedItem is Member) EditClick(sender, new()); }
    async Task Edit(Member? member)
    {
        await Run(async () =>
        {
            var form = new FormWindow(this, member is null ? "添加成员" : "编辑成员", api) { ReconnectSession = reconnect };
            var name = form.Text("名称", "MemberName", member?.Name ?? "", 60); var role = form.Text("职责", "MemberRole", member?.Role ?? "", 120);
            var client = member is null ? form.Choices("客户端", "MemberClient", [new("codex", "Codex"), new("claude_desktop", "Claude Desktop"), new("deepseek_harness", "DeepSeek Harness")], "codex") : null;
            if (member is not null) form.Note(member.ClientName + " · " + member.Status);
            var revision = member?.Revision;
            form.ReloadVersion = async () => { var data = await api().GetAsync<ProjectSnapshot>("projects/" + project); revision = data.Members.Single(x => x.Id == member!.Id).Revision; };
            object Payload() => member is null ? new { kind = "add_member", project_id = project, client = (client!.SelectedItem as Choice)!.Id, name = name.Text, role = role.Text } : new { kind = "update_member", project_id = project, member_id = member.Id, expected_revision = revision, name = name.Text, role = role.Text };
            if (form.Open(Payload) == true) await Saved();
        });
    }
    async void StateClick(object sender, RoutedEventArgs e)
    {
        if (MemberList.SelectedItem is not Member m) { Feedback.Text = "请选择一个成员。"; return; }
        await Run(async () =>
        {
            var state = m.State == "active" ? "inactive" : "active";
            var form = new FormWindow(this, state == "inactive" ? "停用成员" : "启用成员", api) { ReconnectSession = reconnect }; form.Note(m.Name); var revision = m.Revision;
            form.ReloadVersion = async () => { var data = await api().GetAsync<ProjectSnapshot>("projects/" + project); revision = data.Members.Single(x => x.Id == m.Id).Revision; };
            if (form.Open(() => new { kind = "set_member_state", project_id = project, member_id = m.Id, expected_revision = revision, state }) == true) await Saved();
        });
    }
}
