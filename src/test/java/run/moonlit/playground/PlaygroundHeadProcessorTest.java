package run.moonlit.playground;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.withSettings;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.thymeleaf.context.ITemplateContext;
import org.thymeleaf.context.IWebContext;
import org.thymeleaf.model.IModel;
import org.thymeleaf.model.IModelFactory;
import org.thymeleaf.model.IText;
import org.thymeleaf.processor.element.IElementModelStructureHandler;
import run.halo.app.plugin.PluginContext;

class PlaygroundHeadProcessorTest {

    @Test
    void injectsVersionedLazyLoaderFromThePluginStaticRoute() {
        ITemplateContext context = mock(ITemplateContext.class,
            withSettings().extraInterfaces(IWebContext.class));
        var model = mock(IModel.class);
        var modelFactory = mock(IModelFactory.class);
        var text = mock(IText.class);
        var structureHandler = mock(IElementModelStructureHandler.class);
        var pluginContext = PluginContext.builder()
            .name("moonlit-playground")
            .version("0.0.1")
            .build();

        when(context.getModelFactory()).thenReturn(modelFactory);
        when(context.buildLink(
            eq("/plugins/moonlit-playground/assets/playground/loader.js"),
            any()))
            .thenReturn("/plugins/moonlit-playground/assets/playground/loader.js?v=0.0.1");
        var source = ArgumentCaptor.forClass(String.class);
        when(modelFactory.createText(source.capture())).thenReturn(text);

        new PlaygroundHeadProcessor(pluginContext)
            .process(context, model, structureHandler)
            .block();

        verify(model).add(text);
        assertThat(source.getValue())
            .contains("data-moonlit-playground-loader")
            .contains("loader.js?v=0.0.1");
    }

    @Test
    void skipsNonWebTemplateContexts() {
        var context = mock(ITemplateContext.class);
        var model = mock(IModel.class);
        var structureHandler = mock(IElementModelStructureHandler.class);
        var pluginContext = PluginContext.builder()
            .name("moonlit-playground")
            .version("0.0.1")
            .build();

        new PlaygroundHeadProcessor(pluginContext)
            .process(context, model, structureHandler)
            .block();

        verifyNoInteractions(model);
    }
}
