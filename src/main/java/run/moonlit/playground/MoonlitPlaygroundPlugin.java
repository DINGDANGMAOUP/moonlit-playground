package run.moonlit.playground;

import org.springframework.stereotype.Component;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

@Component
public class MoonlitPlaygroundPlugin extends BasePlugin {

    public MoonlitPlaygroundPlugin(PluginContext context) {
        super(context);
    }
}
