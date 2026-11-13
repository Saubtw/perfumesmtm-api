# Agente alojado

Se verificó mediante el SDK oficial OpenAI 7.56.0 el agente existente **Perfume AI Advisor**, modelo `gpt-6.1-sol`, reasoning medium, multi_agent desactivado. `OPENAI_AGENT_ID` y `OPENAI_API_KEY` permanecen en el servidor. No se llama a agents.create ni se cambia la definición guardada.

Se usan `client.beta.agents.sessions.create/update`, `events.stream/create`, `sessions.retrieve`, `items.list` y `sessions.delete`. Cada conversación guarda su ID remoto. La creación envía agent_id, ambiente none e instrucciones específicas del catálogo Perfumes MTM que sustituyen las instrucciones comerciales antiguas. Las únicas herramientas son de catálogo, sin web, shell, MCP administrativo ni subagentes. Cada sesión nueva lleva metadata advisor_policy=catalog-v2. Al continuar se verifica esa versión y se actualiza la lista de herramientas. El SDK no admite cambiar instrucciones mediante sessions.update; las conversaciones de la política anterior deben iniciar un nuevo chat. El frontend utiliza una nueva clave local para evitar restaurar conversaciones comerciales antiguas; no se borran sus datos remotos, sujetos a la retención normal.

`agent.session.requires_action` conduce a consultar required_actions; se valida nombre/argumentos y se envía `agent.session.input.tool_result` con turn_id y call_id. El límite de herramientas es 12 por turno. Los eventos `agent.session.turn.output_text.delta/done` reconstruyen cada parte por item_id/content_index; una respuesta solo es exitosa con el evento final de turno. Se manejan fallos y cancelación. El stream se cierra al terminar y el timeout cancela la ejecución remota.

Funciones: search_catalog, get_perfume_details, compare_perfumes, get_similar_perfumes y present_recommendations. Se eliminó check_availability. Los esquemas no aceptan inventario, precios ni compra. La búsqueda devuelve hasta seis perfumes publicados por afinidad olfativa; todos los registrados pueden recomendarse. present_recommendations acepta hasta cuatro IDs y un mapa reasons de explicaciones breves por ID. El servidor verifica identidad y devuelve únicamente id, name, image, detail_url y reason. No extrae productos del texto con regex. No consulta ni filtra existencias; no genera advertencias de disponibilidad. Las exclusiones de notas se basan en las notas registradas.

Las preferencias permanecen en la conversación remota. No se envían 118 fichas ni todo el historial en cada mensaje. El contexto incluye idioma, hora con zona validada, página/producto comprobado y ubicación/clima opcionales. No incluye IP. El historial vuelve a validar los IDs de llamadas estructuradas para reconstruir tarjetas; si una llamada y su mensaje quedan en páginas distintas, la tarjeta puede faltar en esa página, pero el texto se recupera. No se duplica el historial localmente.

Los límites por IP, visitante, día y sesión se guardan en Supabase. Hay hasta cinco sesiones activas y 40 mensajes por sesión por defecto, 10 mensajes/minuto y 80/día por visitante, más timeout y límite de llamadas. El consumo disponible se registra por turno con latencia y códigos de error. También configurar presupuesto del proyecto OpenAI en su consola; las cuotas de mensajes no son un límite monetario exacto.

Documentación oficial consultada:

- [Configurar y reutilizar agentes](https://developers.openai.com/api/docs/guides/agents-api/configuration)
- [Sesiones persistentes](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [Eventos y recuperación](https://developers.openai.com/api/docs/guides/agents-api/sessions/events)
- [Funciones y resultados](https://developers.openai.com/api/docs/guides/agents-api/tools/functions)
