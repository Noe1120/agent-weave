using System.Windows;
using Team.Core;
namespace Team;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try { var window = new MainWindow(DataLocation.Resolve(e.Args)); MainWindow = window; window.Show(); }
        catch (Exception ex) { MessageBox.Show(ex.Message, "Team", MessageBoxButton.OK, MessageBoxImage.Error); Shutdown(1); }
    }
}
