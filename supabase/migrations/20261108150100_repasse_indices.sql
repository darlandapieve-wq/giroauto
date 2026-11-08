--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

--
-- Name: anuncios anuncios_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.anuncios
    ADD CONSTRAINT anuncios_pkey PRIMARY KEY (id);


--
-- Name: compradores compradores_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.compradores
    ADD CONSTRAINT compradores_pkey PRIMARY KEY (id);


--
-- Name: contas contas_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.contas
    ADD CONSTRAINT contas_pkey PRIMARY KEY (id);


--
-- Name: contas contas_slug_key; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.contas
    ADD CONSTRAINT contas_slug_key UNIQUE (slug);


--
-- Name: contatos contatos_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.contatos
    ADD CONSTRAINT contatos_pkey PRIMARY KEY (conta_id, id);


--
-- Name: conversa_msgs conversa_msgs_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.conversa_msgs
    ADD CONSTRAINT conversa_msgs_pkey PRIMARY KEY (id);


--
-- Name: conversas conversas_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.conversas
    ADD CONSTRAINT conversas_pkey PRIMARY KEY (id);


--
-- Name: envios envios_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.envios
    ADD CONSTRAINT envios_pkey PRIMARY KEY (id);


--
-- Name: fotos fotos_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.fotos
    ADD CONSTRAINT fotos_pkey PRIMARY KEY (id);


--
-- Name: grupos grupos_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.grupos
    ADD CONSTRAINT grupos_pkey PRIMARY KEY (conta_id, jid);


--
-- Name: kv kv_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.kv
    ADD CONSTRAINT kv_pkey PRIMARY KEY (chave);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: mensagens mensagens_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.mensagens
    ADD CONSTRAINT mensagens_pkey PRIMARY KEY (conta_id, id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: wa_auth wa_auth_pkey; Type: CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.wa_auth
    ADD CONSTRAINT wa_auth_pkey PRIMARY KEY (id);


--
-- Name: anuncios_conta_codigo_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE UNIQUE INDEX anuncios_conta_codigo_idx ON repasse.anuncios USING btree (conta_id, codigo);


--
-- Name: anuncios_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX anuncios_conta_idx ON repasse.anuncios USING btree (conta_id);


--
-- Name: anuncios_fp1_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX anuncios_fp1_idx ON repasse.anuncios USING btree (fp1);


--
-- Name: anuncios_fp2_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX anuncios_fp2_idx ON repasse.anuncios USING btree (fp2);


--
-- Name: anuncios_status_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX anuncios_status_idx ON repasse.anuncios USING btree (status, criado_em);


--
-- Name: compradores_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX compradores_conta_idx ON repasse.compradores USING btree (conta_id);


--
-- Name: compradores_tel_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX compradores_tel_idx ON repasse.compradores USING btree (telefone);


--
-- Name: contatos_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX contatos_conta_idx ON repasse.contatos USING btree (conta_id);


--
-- Name: conversa_msgs_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX conversa_msgs_idx ON repasse.conversa_msgs USING btree (conversa_id, id);


--
-- Name: conversas_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX conversas_conta_idx ON repasse.conversas USING btree (conta_id, atualizado_em DESC);


--
-- Name: conversas_contato_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX conversas_contato_idx ON repasse.conversas USING btree (conta_id, canal, contato);


--
-- Name: envios_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX envios_conta_idx ON repasse.envios USING btree (conta_id);


--
-- Name: envios_ts_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX envios_ts_idx ON repasse.envios USING btree (ts);


--
-- Name: fotos_anuncio_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX fotos_anuncio_idx ON repasse.fotos USING btree (anuncio_id, ordem);


--
-- Name: grupos_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX grupos_conta_idx ON repasse.grupos USING btree (conta_id);


--
-- Name: leads_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX leads_conta_idx ON repasse.leads USING btree (conta_id);


--
-- Name: leads_criado_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX leads_criado_idx ON repasse.leads USING btree (criado_em);


--
-- Name: mensagens_chat_ts_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX mensagens_chat_ts_idx ON repasse.mensagens USING btree (chat_jid, ts);


--
-- Name: mensagens_conta_idx; Type: INDEX; Schema: repasse; Owner: -
--

CREATE INDEX mensagens_conta_idx ON repasse.mensagens USING btree (conta_id);


--
-- Name: conversa_msgs conversa_msgs_conversa_id_fkey; Type: FK CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.conversa_msgs
    ADD CONSTRAINT conversa_msgs_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES repasse.conversas(id) ON DELETE CASCADE;


--
-- Name: envios envios_anuncio_id_fkey; Type: FK CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.envios
    ADD CONSTRAINT envios_anuncio_id_fkey FOREIGN KEY (anuncio_id) REFERENCES repasse.anuncios(id) ON DELETE CASCADE;


--
-- Name: fotos fotos_anuncio_id_fkey; Type: FK CONSTRAINT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.fotos
    ADD CONSTRAINT fotos_anuncio_id_fkey FOREIGN KEY (anuncio_id) REFERENCES repasse.anuncios(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


