using System.IO;
using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Team.Core;
namespace Team;

// One small form implementation keeps keyboard, validation, and retry behavior identical.
public sealed class FormWindow : Window
{
    readonly StackPanel fields = new() { Margin = new Thickness(24, 20, 24, 12) };
    readonly TextBlock error = new() { Foreground = new SolidColorBrush(Color.FromRgb(146, 56, 45)), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 10, 0, 0) };
    readonly Button save = new() { Content = "保存", MinWidth = 86, IsDefault = true };
    readonly Button reload = new() { Content = "读取最新版本", Visibility = Visibility.Collapsed };
    readonly Button reconnect = new() { Content = "重新连接", Visibility = Visibility.Collapsed };
    readonly Func<IWorkspaceApi> api;
    CommandAttempt? pending;
    Func<object>? payload;
    string initial = "";
    bool busy, complete;
    public JsonElement Result { get; private set; }
    public Func<Task>? ReloadVersion { get; set; }
    public Func<Task>? ReconnectSession { get; set; }
    public FormWindow(Window owner, string title, Func<IWorkspaceApi> api)
    {
        Owner = owner; Title = title; this.api = api; Width = 490; MaxHeight = 720; SizeToContent = SizeToContent.Height; ResizeMode = ResizeMode.NoResize; WindowStartupLocation = WindowStartupLocation.CenterOwner; ShowInTaskbar = false;
        var root = new DockPanel(); Content = root;
        var footer = new StackPanel() { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(24, 8, 24, 20) };
        var cancel = new Button() { Content = "取消", Margin = new Thickness(0, 0, 8, 0) }; cancel.Click += (_, _) => Close();
        save.Style = (Style)FindResource("PrimaryButton"); save.Click += SaveClick;
        footer.Children.Add(cancel); footer.Children.Add(save); DockPanel.SetDock(footer, Dock.Bottom); root.Children.Add(footer);
        var feedback = new StackPanel() { Margin = new Thickness(24, 0, 24, 0) }; feedback.Children.Add(error); feedback.Children.Add(reload); feedback.Children.Add(reconnect); DockPanel.SetDock(feedback, Dock.Bottom); root.Children.Add(feedback);
        root.Children.Add(new ScrollViewer() { Content = fields, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        AutomationProperties.SetAutomationId(save, "SaveForm"); AutomationProperties.SetAutomationId(error, "FormError"); AutomationProperties.SetLiveSetting(error, AutomationLiveSetting.Assertive);
        AutomationProperties.SetAutomationId(reload, "ReloadVersion"); AutomationProperties.SetAutomationId(reconnect, "ReconnectForm");
        reload.Click += async (_, _) => { if (busy || ReloadVersion is null) return; try { busy = true; await ReloadVersion(); reload.Visibility = Visibility.Collapsed; error.Text = "已读取最新版本；你的输入未更改。"; } catch (Exception e) { error.Text = Explain(e); } finally { busy = false; } };
        reconnect.Click += async (_, _) => { if (busy || ReconnectSession is null) return; try { busy = true; await ReconnectSession(); reconnect.Visibility = Visibility.Collapsed; error.Text = "已重新连接，输入仍保留。"; } catch (Exception e) { error.Text = Explain(e); } finally { busy = false; } };
        Closing += OnClosing;
        PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape) { Close(); e.Handled = true; } };
        Loaded += (_, _) => { if (fields.Children.OfType<FrameworkElement>().FirstOrDefault(x => x is TextBox or ComboBox) is { } first) first.Focus(); };
    }
    public TextBox Text(string label, string id, string value, int max, bool multiline = false)
    {
        fields.Children.Add(new TextBlock() { Text = label, Margin = new Thickness(0, 12, 0, 6) });
        var control = new TextBox() { Text = value, MaxLength = max, MinHeight = multiline ? 84 : 36, MaxHeight = 160, AcceptsReturn = multiline, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        AutomationProperties.SetName(control, label); AutomationProperties.SetAutomationId(control, id); fields.Children.Add(control); return control;
    }
    public ComboBox Choices(string label, string id, Choice[] choices, string? selected)
    {
        fields.Children.Add(new TextBlock() { Text = label, Margin = new Thickness(0, 12, 0, 6) });
        var control = new ComboBox() { ItemsSource = choices, DisplayMemberPath = "Label", SelectedValuePath = "Id", SelectedItem = choices.FirstOrDefault(x => x.Id == selected) };
        AutomationProperties.SetName(control, label); AutomationProperties.SetAutomationId(control, id); fields.Children.Add(control); return control;
    }
    public void Note(string text) => fields.Children.Add(new TextBlock() { Text = text, Margin = new Thickness(0, 10, 0, 0), Foreground = Brushes.DimGray });
    public bool? Open(Func<object> makePayload) { payload = makePayload; initial = JsonSerializer.Serialize(payload(), ApiClient.Json); return ShowDialog(); }
    async void SaveClick(object sender, RoutedEventArgs args)
    {
        if (busy || payload is null) return;
        busy = true; save.IsEnabled = false; fields.IsEnabled = false; error.Text = "";
        try
        {
            pending ??= new CommandAttempt(payload());
            Result = await pending.ExecuteAsync<JsonElement>(api());
            complete = true; busy = false; DialogResult = true;
        }
        catch (ApiException ex)
        {
            if (pending?.HasUncertainResult != true) { pending = null; fields.IsEnabled = true; save.Content = "保存"; }
            if (pending?.HasUncertainResult == true) { save.Content = "重试保存"; error.Text = "提交结果尚未确认。请重试同一操作。\n" + ex.UserMessage; }
            else error.Text = ex.UserMessage;
            if (ex.Code == "REVISION_CONFLICT" && ReloadVersion is not null) reload.Visibility = Visibility.Visible;
            if (ex.RequiresReconnect && ReconnectSession is not null) reconnect.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            if (pending is null) { fields.IsEnabled = true; error.Text = Explain(ex); }
            else { save.Content = "重试保存"; error.Text = "提交结果尚未确认。重试会使用原始内容，不会重复新增。\n" + Explain(ex); }
            if (ReconnectSession is not null) reconnect.Visibility = Visibility.Visible;
        }
        finally { busy = false; save.IsEnabled = true; }
    }
    void OnClosing(object? sender, CancelEventArgs e)
    {
        if (busy) { e.Cancel = true; return; }
        if (complete || payload is null) return;
        if (pending is not null || JsonSerializer.Serialize(payload(), ApiClient.Json) != initial)
        {
            var text = pending is not null ? "提交结果尚未确认。关闭会丢失本次重试信息；请先重试确认。仍要关闭吗？" : "放弃尚未保存的修改？";
            if (MessageBox.Show(this, text, "Team", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes) e.Cancel = true;
        }
    }
    public static string Explain(Exception e) => e switch
    {
        ApiException a => a.UserMessage,
        TaskCanceledException or TimeoutException => "请求超时。请检查本地服务后重试。",
        System.Net.Http.HttpRequestException => "无法连接本地服务。",
        JsonException or InvalidDataException => "服务返回了无法识别的数据，操作未确认。",
        _ => e.Message
    };
}




