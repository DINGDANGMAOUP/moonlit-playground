package run.moonlit.playground;

import java.util.Map;
import org.springframework.stereotype.Component;
import org.thymeleaf.context.Contexts;
import org.thymeleaf.context.ITemplateContext;
import org.thymeleaf.model.IModel;
import org.thymeleaf.processor.element.IElementModelStructureHandler;
import reactor.core.publisher.Mono;
import run.halo.app.plugin.PluginContext;
import run.halo.app.theme.dialect.TemplateHeadProcessor;

/**
 * Adds only the small capability detector to theme pages. The detector loads
 * the frontend runtime when the rendered document actually contains a
 * supported Playground block.
 */
@Component
public class PlaygroundHeadProcessor implements TemplateHeadProcessor {

    private final PluginContext pluginContext;

    public PlaygroundHeadProcessor(PluginContext pluginContext) {
        this.pluginContext = pluginContext;
    }

    @Override
    public Mono<Void> process(ITemplateContext context, IModel model,
        IElementModelStructureHandler structureHandler) {
        if (!Contexts.isWebContext(context)) {
            return Mono.empty();
        }
        var loaderPath = "/plugins/%s/assets/playground/loader.js"
            .formatted(pluginContext.getName());
        var loaderUrl = context.buildLink(loaderPath, Map.of("v", pluginContext.getVersion()));
        var tags = """
            <!-- Moonlit Playground start -->
            <script defer src="%s" data-moonlit-playground-loader></script>
            <!-- Moonlit Playground end -->
            """.formatted(loaderUrl);
        model.add(context.getModelFactory().createText(tags));
        return Mono.empty();
    }
}
