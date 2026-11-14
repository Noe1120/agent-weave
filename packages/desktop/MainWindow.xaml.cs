using System.IO;
using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Team.Core;

namespace Team;

public partial class MainWindow : Window
{
    readonly string database;
    ServiceHost? host;
    WorkspaceController? controller;
    string? wantedProject;
    bool busy, rendering, closing, closed;
    List<Message> messages = [];
    string? before;
    bool searching;
    IWorkspaceApi Api => host?.Api ?? throw new InvalidOperationException("服务尚未连接。");
    ProjectSnapshot Current => controller?.Current ?? throw new InvalidOperationException("请先选择项目。");
    public MainWindow(string database)
    {
        this.database = database; InitializeComponent(); SetBusy(true);
        PreviewKeyDown += OnKey;
    }
    async void OnLoaded(object sender, RoutedEventArgs e) => await Run(ConnectAsync);
    void SetBusy(bool value)
    {
        busy = value;
        NewProject.IsEnabled = !value && host?.IsRunning == true;
        ProjectList.IsEnabled = !value && host?.IsRunning == true;
        ContentTabs.IsEnabled = !value && host?.IsRunning == true && controller?.Current is not null;
        RefreshButton.IsEnabled = !value && host?.IsRunning == true && wantedProject is not null;
        MembersButton.IsEnabled = ProgressButton.IsEnabled = !value && host?.IsRunning == true && controller?.Current is not null;
        Reconnect.IsEnabled = !value;
    }
    async Task Run(Func<Task> work)
    {
        SetBusy(true); ClearError();
        try { await work(); }
        catch (Exception ex)
        {
            ShowError(FormWindow.Explain(ex));
            if (host?.IsRunning != true) { StatusText.Text = "服务未连接"; EmptyProject.Text = "尚未连接"; }
            if (host?.IsRunning != true || ex is ApiException { RequiresReconnect: true } || ex is System.Net.Http.HttpRequestException) Reconnect.Visibility = Visibility.Visible;
        }
        finally { if (!closed) SetBusy(false); }
    }
    void ShowError(string text) { ErrorText.Text = text; ErrorPanel.Visibility = Visibility.Visible; }
    void ClearError() { ErrorText.Text = ""; ErrorPanel.Visibility = Visibility.Collapsed; }
    async Task ConnectAsync()
    {
        RememberInput(); StatusText.Text = "正在连接…";
        ContentTabs.Visibility = Visibility.Collapsed; EmptyProject.Visibility = Visibility.Visible; EmptyProject.Text = "正在连接…";
        if (host is not null) { var old = host; host = null; await old.DisposeAsync(); }
        var root = AppContext.BaseDirectory;
        host = await ServiceHost.StartAsync(Path.Combine(root, "runtime", "node.exe"), Path.Combine(root, "service", "packages", "service", "src", "desktop-entry.js"), database);
        var observedHost = host;
        host.UnexpectedExit += () => Dispatcher.BeginInvoke(() =>
        {
            if (closed || host != observedHost) return;
            ShowError("本地服务已退出。输入已保留，请重新连接。"); StatusText.Text = "服务未连接"; Reconnect.Visibility = Visibility.Visible; SetBusy(busy);
        });
        if (controller is null) controller = new(host.Api); else controller.Reconnect(host.Api);
        Reconnect.Visibility = Visibility.Collapsed;
        StatusText.Text = "Agent 未连接 · 内容仅保存在本机";
        await LoadProjects(wantedProject);
    }
    async Task LoadProjects(string? selected = null)
    {
        var list = await Api.GetAsync<Project[]>("projects");
        rendering = true; ProjectList.ItemsSource = list; ProjectList.SelectedItem = list.FirstOrDefault(p => p.Id == selected) ?? list.FirstOrDefault(); rendering = false;
        if (ProjectList.SelectedItem is Project p) { wantedProject = p.Id; await LoadProject(p.Id); ProjectList.ScrollIntoView(p); }
        else { ProjectTitle.Text = "项目"; EmptyProject.Text = "暂无项目"; EmptyProject.Visibility = Visibility.Visible; ContentTabs.Visibility = Visibility.Collapsed; }
    }
    void RememberInput()
    {
        if (rendering || controller?.SelectedId is not { } id) return;
        var input = controller.Input(id); if (input.Pending is not null) return;
        input.Body = MessageInput.Text; input.RecipientId = (Recipient.SelectedItem as Choice)?.Id;
    }
    async Task LoadProject(string id)
    {
        RememberInput(); ContentTabs.Visibility = Visibility.Collapsed; EmptyProject.Visibility = Visibility.Visible; EmptyProject.Text = "正在读取…";
        ProjectTitle.Text = (ProjectList.Items.OfType<Project>().FirstOrDefault(x => x.Id == id))?.Name ?? "项目";
        try { await controller!.SelectProjectAsync(id); } catch { EmptyProject.Text = "暂时无法读取"; throw; }
        if (controller.Current?.Project.Id != id) return;
        wantedProject = id; RenderProject();
    }
    void RenderProject()
    {
        var data = Current; rendering = true;
        ProjectTitle.Text = data.Project.Name; Title = data.Project.Name + " — Team";
        ProjectTitle.ToolTip = string.IsNullOrWhiteSpace(data.Project.Description) ? null : data.Project.Description;
        System.Windows.Automation.AutomationProperties.SetHelpText(ProjectTitle, data.Project.Description);
        EmptyProject.Visibility = Visibility.Collapsed; ContentTabs.Visibility = Visibility.Visible;
        messages = data.Messages.Items.ToList(); before = data.Messages.NextBefore; searching = false; SearchInput.Text = ""; ClearSearch.Visibility = Visibility.Collapsed;
        var input = controller!.Input(data.Project.Id);
        var choices = new List<Choice> { new(null, "群聊") }; choices.AddRange(data.Members.Select(x => new Choice(x.Id, "仅 " + x.Label)));
        if (input.RecipientId is not null && choices.All(x => x.Id != input.RecipientId)) choices.Add(new(input.RecipientId, "原收件人（不可用）"));
        Recipient.ItemsSource = choices; Recipient.SelectedItem = choices.First(x => x.Id == input.RecipientId); MessageInput.Text = input.Body;
        Recipient.IsEnabled = MessageInput.IsEnabled = input.Pending is null; SaveMessage.Content = input.Pending is null ? "保存消息" : "重试保存";
        RenderMessages(true); RenderTasks(); rendering = false;
    }
    void RenderMessages(bool bottom = false)
    {
        MessageList.ItemsSource = messages.ToArray(); EmptyMessages.Visibility = messages.Count == 0 ? Visibility.Visible : Visibility.Collapsed; EmptyMessages.Text = searching ? "未找到消息" : "暂无消息";
        OlderMessages.Visibility = !searching && before is not null ? Visibility.Visible : Visibility.Collapsed;
        if (bottom) Dispatcher.BeginInvoke(() => MessageScroll.ScrollToEnd(), System.Windows.Threading.DispatcherPriority.Loaded);
    }
    void RenderTasks()
    {
        if (controller?.Current is not { } data) return;
        var selected = (TaskList.SelectedItem as Draft)?.Id;
        var tasks = data.Tasks.Where(x => x.State == (ShowArchived.IsChecked == true ? "archived" : "draft")).ToArray(); TaskList.ItemsSource = tasks; TaskList.SelectedItem = tasks.FirstOrDefault(x => x.Id == selected);
        EmptyTasks.Visibility = tasks.Length == 0 ? Visibility.Visible : Visibility.Collapsed; ArchiveTask.Content = ShowArchived.IsChecked == true ? "恢复" : "归档";
    }
    async void ProjectChanged(object sender, SelectionChangedEventArgs e)
    {
        if (rendering || busy || ProjectList.SelectedItem is not Project p) return;
        wantedProject = p.Id; await Run(() => LoadProject(p.Id));
    }
    void ComposerChanged(object sender, TextChangedEventArgs e) => RememberInput();
    void RecipientChanged(object sender, SelectionChangedEventArgs e) => RememberInput();
    async void RefreshClick(object sender, RoutedEventArgs e) { if (!busy && wantedProject is { } id) await Run(() => LoadProject(id)); }
    async void ReconnectClick(object sender, RoutedEventArgs e) { if (!busy) await Run(ConnectAsync); }
    async Task RefreshAfterSave(string id)
    {
        try { await LoadProject(id); } catch (Exception ex) { EmptyProject.Text = "暂时无法读取"; ShowError("已保存，但刷新失败。请重新读取；不要重复新建。\n" + FormWindow.Explain(ex)); }
    }
    async void SaveMessageClick(object sender, RoutedEventArgs e) => await SaveMessageAsync();
    async Task SaveMessageAsync()
    {
        if (busy || controller?.SelectedId is not { } id) return;
        RememberInput(); var input = controller.Input(id);
        if (input.Pending is null && string.IsNullOrWhiteSpace(input.Body)) { MessageInput.Focus(); return; }
        await Run(async () =>
        {
            input.Pending ??= new CommandAttempt(new { kind = "send_message", project_id = id, body = input.Body, audience = input.RecipientId is null ? "public" : "direct", recipient_id = input.RecipientId });
            try { await input.Pending.ExecuteAsync<Message>(Api); }
            catch (ApiException ex)
            {
                if (input.Pending?.HasUncertainResult != true) { input.Pending = null; MessageInput.IsEnabled = Recipient.IsEnabled = true; SaveMessage.Content = "保存消息"; throw; }
                MessageInput.IsEnabled = Recipient.IsEnabled = false; SaveMessage.Content = "重试保存";
                if (ex.RequiresReconnect) Reconnect.Visibility = Visibility.Visible;
                throw new IOException("提交结果尚未确认。请重试同一条消息。\n" + ex.UserMessage, ex);
            }
            catch { Reconnect.Visibility = Visibility.Visible; MessageInput.IsEnabled = Recipient.IsEnabled = false; SaveMessage.Content = "重试保存"; throw new IOException("提交结果尚未确认。点击“重试保存”会核对同一条消息，不会重复新增。输入和收件人已锁定。"); }
            input.Pending = null; input.Body = ""; rendering = true; MessageInput.Clear(); rendering = false;
            await RefreshAfterSave(id);
        });
    }
    void ComposerKey(object sender, KeyEventArgs e) { if (e.Key == Key.Enter && Keyboard.Modifiers.HasFlag(ModifierKeys.Control)) { e.Handled = true; SaveMessageClick(sender, new()); } }
    async void SearchClick(object sender, RoutedEventArgs e)
    {
        if (busy || controller?.SelectedId is not { } id) return;
        var q = SearchInput.Text; if (string.IsNullOrWhiteSpace(q)) { SearchInput.Focus(); return; }
        await Run(async () => { var result = await Api.GetAsync<SearchPage>("projects/" + id + "/search?q=" + Uri.EscapeDataString(q)); messages = result.Items.ToList(); searching = true; ClearSearch.Visibility = Visibility.Visible; RenderMessages(); if (result.Truncated) ShowError("仅显示最近 50 条匹配消息，请缩小搜索范围。"); });
    }
    void SearchKey(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) { e.Handled = true; SearchClick(sender, new()); } }
    async void ClearSearchClick(object sender, RoutedEventArgs e) { if (!busy && wantedProject is { } id) await Run(() => LoadProject(id)); }
    async void OlderClick(object sender, RoutedEventArgs e)
    {
        if (busy || controller?.SelectedId is not { } id || before is null) return;
        await Run(async () => { var page = await Api.GetAsync<MessagePage>("projects/" + id + "/messages?before=" + Uri.EscapeDataString(before)); messages.InsertRange(0, page.Items); before = page.NextBefore; RenderMessages(); });
    }
    FormWindow Form(string title) => new(this, title, () => Api) { ReconnectSession = ConnectAsync };
    async void NewProjectClick(object sender, RoutedEventArgs e)
    {
        if (busy) return;
        await Run(async () =>
        {
            var form = Form("新建项目"); var name = form.Text("名称", "ProjectName", "", 80); var description = form.Text("描述", "ProjectDescription", "", 4000, true);
            if (form.Open(() => new { kind = "create_project", name = name.Text, description = description.Text }) == true)
            {
                var project = form.Result.Deserialize<Project>(ApiClient.Json)!; wantedProject = project.Id;
                try { await LoadProjects(project.Id); } catch (Exception ex) { ShowError("项目已创建，但刷新失败。\n" + FormWindow.Explain(ex)); }
            }
        });
    }
    async void NewTaskClick(object sender, RoutedEventArgs e) => await EditTask(null);
    async void EditTaskClick(object sender, RoutedEventArgs e) { if (TaskList.SelectedItem is Draft task) await EditTask(task); else if (!busy) ShowError("请选择一个任务。"); }
    void TaskDoubleClick(object sender, MouseButtonEventArgs e) { if (TaskList.SelectedItem is Draft) EditTaskClick(sender, new()); }
    void TaskKey(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) { e.Handled = true; EditTaskClick(sender, new()); } }
    async Task EditTask(Draft? task)
    {
        if (busy || controller?.Current is not { } data) return;
        if (task?.State == "archived") { ShowError("请先恢复归档任务，再编辑。"); return; }
        await Run(async () =>
        {
            var form = Form(task is null ? "新建任务" : "编辑任务"); var title = form.Text("标题", "TaskTitle", task?.Title ?? "", 160); var description = form.Text("内容", "TaskDescription", task?.Description ?? "", 4000, true); var acceptance = form.Text("验收条件", "TaskAcceptance", task?.Acceptance ?? "", 2000, true);
            var choices = new List<Choice> { new(null, "未分配") }; choices.AddRange(data.Members.Select(x => new Choice(x.Id, x.Label)));
            if (task?.AssigneeId is { } missing && choices.All(x => x.Id != missing)) choices.Add(new(missing, "原负责人（不可用）"));
            var assignee = form.Choices("负责人", "TaskAssignee", choices.ToArray(), task?.AssigneeId); var revision = task?.Revision;
            form.ReloadVersion = async () => { var latest = await Api.GetAsync<ProjectSnapshot>("projects/" + data.Project.Id); var current = latest.Tasks.SingleOrDefault(x => x.Id == task?.Id) ?? throw new IOException("任务已不存在。"); if (current.State != "draft") throw new IOException("任务已归档；请保留内容，恢复任务后再编辑。"); revision = current.Revision; };
            object Payload() => task is null ? new { kind = "create_draft", project_id = data.Project.Id, title = title.Text, description = description.Text, acceptance = acceptance.Text, assignee_id = (assignee.SelectedItem as Choice)?.Id } : new { kind = "update_draft", project_id = data.Project.Id, task_id = task.Id, expected_revision = revision, title = title.Text, description = description.Text, acceptance = acceptance.Text, assignee_id = (assignee.SelectedItem as Choice)?.Id };
            if (form.Open(Payload) == true) await RefreshAfterSave(data.Project.Id);
        });
    }
    void ArchiveFilterChanged(object sender, RoutedEventArgs e) => RenderTasks();
    async void ArchiveTaskClick(object sender, RoutedEventArgs e)
    {
        if (busy || controller?.SelectedId is not { } id) return;
        if (TaskList.SelectedItem is not Draft task) { ShowError("请选择一个任务。"); return; }
        await Run(async () =>
        {
            var form = Form(task.State == "archived" ? "恢复任务" : "归档任务"); form.Note(task.Title);
            if (form.Open(() => new { kind = task.State == "archived" ? "restore_draft" : "archive_draft", project_id = id, task_id = task.Id, expected_revision = task.Revision }) == true) await RefreshAfterSave(id);
        });
    }
    async void MembersClick(object sender, RoutedEventArgs e)
    {
        if (busy || controller?.Current is not { } data) return;
        await Run(async () => { var window = new MembersWindow(this, data.Project.Id, () => Api, ConnectAsync); window.ShowDialog(); await RefreshAfterSave(data.Project.Id); });
    }
    async void ProgressClick(object sender, RoutedEventArgs e)
    {
        if (busy || controller?.SelectedId is not { } id) return;
        await Run(async () => { var data = await Api.GetAsync<ProjectSnapshot>("projects/" + id); var p = data.Progress; MessageBox.Show(this, $"成员　{p.RegisteredMembers}\n已连接　{p.ConnectedMembers}\n任务草稿　{p.DraftTasks}\n已归档　{p.ArchivedTasks}\n模型调用　{p.ModelCalls}\n\n尚未启用 Agent 执行。", "进度", MessageBoxButton.OK, MessageBoxImage.Information); });
    }
    void AboutClick(object sender, RoutedEventArgs e) => MessageBox.Show(this, "Team 0.3.0 · 原生 Windows 工作台\n\n" + database + "\n\n" + (host?.Diagnostic ?? "") + "\n原客户端接入与强制隔离尚未验证。", "关于 Team", MessageBoxButton.OK, MessageBoxImage.Information);
    void OnKey(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F5) { e.Handled = true; RefreshClick(sender, new()); }
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.N) { e.Handled = true; NewProjectClick(sender, new()); }
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.F) { e.Handled = true; ContentTabs.SelectedIndex = 0; SearchInput.Focus(); SearchInput.SelectAll(); }
    }
    async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (closed) return;
        e.Cancel = true; if (closing) return;
        if (busy) { ShowError("操作尚未完成，请稍后关闭。"); return; }
        RememberInput();
        if ((controller?.HasUnsavedInput == true) && MessageBox.Show(this, "有尚未保存或未确认的内容。仍要关闭吗？", "Team", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        closing = true; SetBusy(true); StatusText.Text = "正在关闭…";
        try { if (host is not null) await host.DisposeAsync(); }
        catch (Exception ex) { MessageBox.Show(this, "服务退出检查失败：" + FormWindow.Explain(ex), "Team", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { host = null; closed = true; Close(); }
    }
}






